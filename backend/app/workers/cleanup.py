import logging
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.database import SessionLocal
from app.models.conversion_job import ConversionJob
from app.services.storage import cleanup_file
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="cleanup_expired_jobs")
def cleanup_expired_jobs():
    """Delete jobs and their files older than JOB_TTL_HOURS."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.JOB_TTL_HOURS)
    db = SessionLocal()
    try:
        expired_jobs = (
            db.query(ConversionJob)
            .filter(ConversionJob.created_at < cutoff)
            .all()
        )
        count = 0
        for job in expired_jobs:
            if job.downloaded_file_path:
                cleanup_file(job.downloaded_file_path)
            if job.converted_file_path:
                cleanup_file(job.converted_file_path)
            db.delete(job)
            count += 1
        db.commit()
        logger.info(f"Cleaned up {count} expired jobs")
    finally:
        db.close()
