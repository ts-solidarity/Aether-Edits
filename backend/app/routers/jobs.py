import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import limiter
from app.models.conversion_job import ConversionJob
from app.schemas.job import JobCreateRequest, JobCreateResponse, JobStatusResponse
from app.services.storage import get_upload_path
from app.utils.formats import ALL_FORMAT_VALUES, SUPPORTED_FORMATS
from app.utils.url_validator import validate_url_safe
from app.workers.tasks import convert_uploaded_file, download_and_convert

router = APIRouter()

MAX_UPLOAD_BYTES = settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024


def _check_concurrent_limit(client_ip: str, db: Session):
    """Reject if this IP has too many active jobs."""
    active_count = (
        db.query(ConversionJob)
        .filter(
            ConversionJob.client_ip == client_ip,
            ConversionJob.status.in_(["pending", "downloading", "converting"]),
        )
        .count()
    )
    if active_count >= settings.MAX_CONCURRENT_JOBS_PER_IP:
        raise HTTPException(
            status_code=429,
            detail=f"Too many active jobs (max {settings.MAX_CONCURRENT_JOBS_PER_IP}). Wait for current jobs to finish.",
        )


@router.post("/jobs", response_model=JobCreateResponse)
@limiter.limit(lambda: f"{settings.RATE_LIMIT_PER_HOUR}/hour")
def create_job(req: JobCreateRequest, request: Request, db: Session = Depends(get_db)):
    source_url = str(req.source_url)
    validate_url_safe(source_url)

    client_ip = request.client.host
    _check_concurrent_limit(client_ip, db)

    job = ConversionJob(
        source_url=source_url,
        output_format=req.output_format,
        client_ip=client_ip,
        source_type="url",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    download_and_convert.delay(job.id)

    return JobCreateResponse(id=job.id, status=job.status)


@router.post("/jobs/upload", response_model=JobCreateResponse)
@limiter.limit(lambda: f"{settings.RATE_LIMIT_PER_HOUR}/hour")
async def upload_file(
    request: Request,
    file: UploadFile,
    output_format: str,
    db: Session = Depends(get_db),
):
    if output_format not in ALL_FORMAT_VALUES:
        raise HTTPException(status_code=400, detail="Unsupported output format")

    client_ip = request.client.host
    _check_concurrent_limit(client_ip, db)

    # Validate file extension
    original = file.filename or "upload"
    ext = Path(original).suffix.lstrip(".")
    if not ext:
        raise HTTPException(status_code=400, detail="File must have an extension")

    # Read file in chunks, enforcing size limit
    job = ConversionJob(
        output_format=output_format,
        client_ip=client_ip,
        source_type="upload",
        original_filename=original,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    upload_path = get_upload_path(job.id, ext)
    total_read = 0
    chunk_size = 1024 * 1024  # 1MB chunks

    try:
        with open(upload_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_read += len(chunk)
                if total_read > MAX_UPLOAD_BYTES:
                    upload_path.unlink(missing_ok=True)
                    db.delete(job)
                    db.commit()
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large (max {settings.MAX_DOWNLOAD_SIZE_MB}MB)",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        upload_path.unlink(missing_ok=True)
        db.delete(job)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    # Update job with the uploaded file path
    job.downloaded_file_path = str(upload_path)
    job.input_format = ext
    db.commit()

    convert_uploaded_file.delay(job.id)

    return JobCreateResponse(id=job.id, status=job.status)


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ConversionJob).filter(ConversionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/stream")
async def stream_job_status(job_id: str):
    """SSE endpoint that streams job status updates."""

    async def event_generator():
        from app.database import SessionLocal

        while True:
            db = SessionLocal()
            try:
                job = db.query(ConversionJob).filter(ConversionJob.id == job_id).first()
                if not job:
                    yield f"data: {json.dumps({'error': 'Job not found'})}\n\n"
                    return

                payload = {
                    "id": job.id,
                    "status": job.status,
                    "progress_percent": job.progress_percent,
                    "error_message": job.error_message,
                    "file_size_bytes": job.file_size_bytes,
                }
                yield f"data: {json.dumps(payload)}\n\n"

                if job.status in ("completed", "failed"):
                    return
            finally:
                db.close()

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/jobs/{job_id}/download")
def download_file(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ConversionJob).filter(ConversionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "completed":
        raise HTTPException(status_code=400, detail="Job not completed yet")
    if not job.converted_file_path:
        raise HTTPException(status_code=404, detail="Converted file not found")

    file_path = Path(job.converted_file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File no longer available")

    filename = job.original_filename or f"converted.{job.output_format}"
    if not filename.endswith(f".{job.output_format}"):
        filename = f"{Path(filename).stem}.{job.output_format}"

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )


@router.get("/formats")
def list_formats():
    return SUPPORTED_FORMATS
