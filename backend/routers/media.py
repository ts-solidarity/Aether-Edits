import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from config import settings
from models.database import get_db
from models.project import MediaAsset
from models.schemas import MediaMetadataResponse
from services.ffprobe import get_media_metadata

router = APIRouter(prefix="/api/media", tags=["media"])

CHUNK_SIZE = 1024 * 1024  # 1MB


@router.post("/upload", response_model=MediaMetadataResponse)
async def upload_media(
    file: UploadFile = File(...),
    project_id: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
):
    asset_id = str(uuid.uuid4())
    ext = Path(file.filename or "video").suffix or ".mp4"
    dest = settings.upload_path / f"{asset_id}{ext}"

    size = 0
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    with open(dest, "wb") as f:
        while chunk := await file.read(CHUNK_SIZE):
            size += len(chunk)
            if size > max_bytes:
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "File too large")
            f.write(chunk)

    try:
        meta = await get_media_metadata(dest)
    except RuntimeError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"Invalid media file: {e}")

    asset = MediaAsset(
        id=asset_id,
        project_id=project_id or None,
        filename=file.filename or "unknown",
        file_path=str(dest),
        duration=meta["duration"],
        width=meta["width"],
        height=meta["height"],
        codec=meta["codec"],
    )
    db.add(asset)
    await db.commit()

    return MediaMetadataResponse(
        id=asset_id,
        filename=asset.filename,
        duration=meta["duration"],
        width=meta["width"],
        height=meta["height"],
        codec=meta["codec"],
    )


@router.get("/{media_id}", response_model=MediaMetadataResponse)
async def get_media_info(media_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MediaAsset).where(MediaAsset.id == media_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Media not found")
    return MediaMetadataResponse(
        id=asset.id,
        filename=asset.filename,
        duration=asset.duration,
        width=asset.width,
        height=asset.height,
        codec=asset.codec,
    )
