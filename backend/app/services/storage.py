from pathlib import Path

from app.config import settings


def get_download_path(job_id: str, extension: str) -> Path:
    return settings.downloads_dir / f"{job_id}.{extension}"


def get_converted_path(job_id: str, extension: str) -> Path:
    return settings.converted_dir / f"{job_id}.{extension}"


def cleanup_file(path: str | Path) -> None:
    p = Path(path)
    if p.exists():
        p.unlink()
