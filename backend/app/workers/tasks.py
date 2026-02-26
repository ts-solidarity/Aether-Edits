import logging
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models.conversion_job import ConversionJob
from app.services.converter import convert_media
from app.services.downloader import download_media
from app.services.storage import cleanup_file, get_converted_path, get_download_path
from app.utils.exceptions import ConversionError, DownloadError
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _update_job(job_id: str, **kwargs):
    """Update job fields in the database."""
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.id == job_id).first()
        if job:
            for key, value in kwargs.items():
                setattr(job, key, value)
            db.commit()
    finally:
        db.close()


@celery_app.task(
    name="download_and_convert",
    bind=True,
    autoretry_for=(DownloadError,),
    retry_backoff=True,
    max_retries=settings.CELERY_MAX_RETRIES,
)
def download_and_convert(self, job_id: str):
    """Main task: download media from URL and convert to target format."""
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return
        source_url = job.source_url
        output_format = job.output_format
    finally:
        db.close()

    try:
        # Phase 1: Download
        _update_job(job_id, status="downloading", progress_percent=0)

        def download_progress(percent):
            # Download is 0-50% of total progress
            _update_job(job_id, progress_percent=percent // 2)

        download_path = get_download_path(job_id, "tmp")
        result = download_media(
            url=source_url,
            output_path=download_path,
            progress_callback=download_progress,
        )

        actual_download_path = result["path"]
        input_format = result["ext"]
        _update_job(
            job_id,
            downloaded_file_path=actual_download_path,
            input_format=input_format,
            progress_percent=50,
        )

        # Phase 2: Convert
        _update_job(job_id, status="converting")

        converted_path = get_converted_path(job_id, output_format)

        def convert_progress(percent):
            # Conversion is 50-100% of total progress
            _update_job(job_id, progress_percent=50 + percent // 2)

        convert_media(
            input_path=actual_download_path,
            output_path=converted_path,
            output_format=output_format,
            progress_callback=convert_progress,
        )

        file_size = Path(converted_path).stat().st_size

        _update_job(
            job_id,
            status="completed",
            progress_percent=100,
            converted_file_path=str(converted_path),
            file_size_bytes=file_size,
        )

        # Clean up the raw download
        cleanup_file(actual_download_path)

    except (DownloadError, ConversionError) as e:
        logger.error(f"Job {job_id} failed: {e}")
        _update_job(job_id, status="failed", error_message=str(e))
        if isinstance(e, DownloadError):
            raise  # Let autoretry handle it
    except Exception as e:
        logger.exception(f"Job {job_id} unexpected error")
        _update_job(job_id, status="failed", error_message=f"Unexpected error: {e}")


@celery_app.task(name="convert_uploaded_file")
def convert_uploaded_file(job_id: str):
    """Convert an uploaded file (skip download, 0-100% is all conversion)."""
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return
        uploaded_path = job.downloaded_file_path
        output_format = job.output_format
    finally:
        db.close()

    try:
        _update_job(job_id, status="converting", progress_percent=0)

        converted_path = get_converted_path(job_id, output_format)

        def convert_progress(percent):
            _update_job(job_id, progress_percent=min(percent, 99))

        convert_media(
            input_path=uploaded_path,
            output_path=converted_path,
            output_format=output_format,
            progress_callback=convert_progress,
        )

        file_size = Path(converted_path).stat().st_size

        _update_job(
            job_id,
            status="completed",
            progress_percent=100,
            converted_file_path=str(converted_path),
            file_size_bytes=file_size,
        )

        # Clean up the uploaded file
        cleanup_file(uploaded_path)

    except ConversionError as e:
        logger.error(f"Job {job_id} failed: {e}")
        _update_job(job_id, status="failed", error_message=str(e))
    except Exception as e:
        logger.exception(f"Job {job_id} unexpected error")
        _update_job(job_id, status="failed", error_message=f"Unexpected error: {e}")
