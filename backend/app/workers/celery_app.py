from celery import Celery

from app.config import settings

celery_app = Celery(
    "media_converter",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    beat_schedule={
        "cleanup-expired-jobs": {
            "task": "cleanup_expired_jobs",
            "schedule": 3600.0,  # every hour
        },
    },
)

# Auto-discover tasks
celery_app.autodiscover_tasks(["app.workers"])
