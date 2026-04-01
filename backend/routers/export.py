import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.database import get_db
from models.project import MediaAsset
from models.schemas import ExportRequest, ExportStatusResponse
from services.export_manager import ExportJob, export_manager
from services.ffmpeg import build_export_command, run_ffmpeg

router = APIRouter(prefix="/api/export", tags=["export"])


@router.post("", response_model=ExportStatusResponse)
async def start_export(
    req: ExportRequest,
    db: AsyncSession = Depends(get_db),
):
    job_id = str(uuid.uuid4())

    media_ids = {c.media_id for t in req.tracks for c in t.clips}
    result = await db.execute(
        select(MediaAsset).where(MediaAsset.id.in_(media_ids))
    )
    assets = {a.id: a for a in result.scalars().all()}

    missing = media_ids - assets.keys()
    if missing:
        raise HTTPException(400, f"Media not found: {', '.join(missing)}")

    media_paths = {aid: a.file_path for aid, a in assets.items()}
    output_path = settings.export_path / f"{job_id}.{req.output_format}"

    export_manager.create(job_id)

    asyncio.create_task(_run_export(job_id, req, media_paths, output_path))

    return ExportStatusResponse(job_id=job_id, status="queued")


async def _run_export(
    job_id: str,
    req: ExportRequest,
    media_paths: dict[str, str],
    output_path: Path,
):
    export_manager.update(job_id, status="processing", progress=0.1)
    try:
        cmd = build_export_command(req.tracks, media_paths, output_path)
        await run_ffmpeg(cmd, timeout=settings.FFMPEG_TIMEOUT_SECONDS)
        export_manager.update(
            job_id, status="done", progress=1.0, output_path=str(output_path)
        )
    except Exception as e:
        export_manager.update(job_id, status="error", error=str(e))


@router.get("/{job_id}/progress")
async def export_progress(job_id: str):
    job = export_manager.get(job_id)
    if not job:
        raise HTTPException(404, "Export job not found")

    async def stream():
        while True:
            j = export_manager.get(job_id)
            if not j:
                break
            data = ExportStatusResponse(
                job_id=j.job_id,
                status=j.status,
                progress=j.progress,
                error=j.error,
            ).model_dump_json()
            yield f"data: {data}\n\n"
            if j.status in ("done", "error"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/{job_id}/download")
async def download_export(job_id: str):
    job = export_manager.get(job_id)
    if not job:
        raise HTTPException(404, "Export job not found")
    if job.status != "done" or not job.output_path:
        raise HTTPException(400, "Export not ready")

    path = Path(job.output_path)
    if not path.exists():
        raise HTTPException(404, "Export file not found")

    return FileResponse(path, filename=path.name, media_type="application/octet-stream")
