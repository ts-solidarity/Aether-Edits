from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.conversion_job import ConversionJob
from app.schemas.job import JobCreateRequest, JobCreateResponse, JobStatusResponse
from app.utils.formats import ALL_FORMAT_VALUES, SUPPORTED_FORMATS
from app.workers.tasks import download_and_convert

router = APIRouter()


@router.post("/jobs", response_model=JobCreateResponse)
def create_job(req: JobCreateRequest, db: Session = Depends(get_db)):
    if req.output_format not in ALL_FORMAT_VALUES:
        raise HTTPException(status_code=400, detail="Unsupported output format")

    job = ConversionJob(
        source_url=str(req.source_url),
        output_format=req.output_format,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    download_and_convert.delay(job.id)

    return JobCreateResponse(id=job.id, status=job.status)


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ConversionJob).filter(ConversionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


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

    filename = f"converted.{job.output_format}"
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )


@router.get("/formats")
def list_formats():
    return SUPPORTED_FORMATS
