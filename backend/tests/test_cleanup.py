from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.models.conversion_job import ConversionJob


@patch("app.workers.cleanup.cleanup_file")
def test_cleanup_expired_jobs(mock_cleanup, db_session):
    from app.workers.cleanup import cleanup_expired_jobs

    # Create an old job (expired)
    old_job = ConversionJob(
        source_url="https://example.com/old.mp4",
        output_format="mp3",
        status="completed",
        converted_file_path="/tmp/old.mp3",
        created_at=datetime.now(timezone.utc) - timedelta(hours=48),
    )
    db_session.add(old_job)

    # Create a recent job (should not be cleaned)
    recent_job = ConversionJob(
        source_url="https://example.com/new.mp4",
        output_format="mp3",
        status="completed",
    )
    db_session.add(recent_job)
    db_session.commit()

    old_id = old_job.id
    recent_id = recent_job.id

    with patch("app.workers.cleanup.SessionLocal", return_value=db_session):
        cleanup_expired_jobs()

    # Old job should be deleted
    assert db_session.query(ConversionJob).filter(ConversionJob.id == old_id).first() is None
    # Recent job should remain
    assert db_session.query(ConversionJob).filter(ConversionJob.id == recent_id).first() is not None
    # Cleanup should have been called for the old job's file
    mock_cleanup.assert_called_once_with("/tmp/old.mp3")
