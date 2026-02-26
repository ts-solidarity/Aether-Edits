from unittest.mock import patch


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_formats(client):
    response = client.get("/api/formats")
    assert response.status_code == 200
    data = response.json()
    assert "video" in data
    assert "audio" in data
    assert len(data["video"]) > 0
    assert len(data["audio"]) > 0


@patch("app.routers.jobs.download_and_convert")
@patch("app.routers.jobs.validate_url_safe")
def test_create_job(mock_validate, mock_task, client):
    mock_task.delay.return_value = None
    response = client.post(
        "/api/jobs",
        json={"source_url": "https://example.com/video.mp4", "output_format": "mp3"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["status"] == "pending"


@patch("app.routers.jobs.validate_url_safe")
def test_create_job_invalid_format(mock_validate, client):
    response = client.post(
        "/api/jobs",
        json={"source_url": "https://example.com/video.mp4", "output_format": "xyz"},
    )
    assert response.status_code == 422


def test_get_job_not_found(client):
    response = client.get("/api/jobs/nonexistent-id")
    assert response.status_code == 404


def test_download_before_complete(client, db_session):
    from app.models.conversion_job import ConversionJob

    job = ConversionJob(
        source_url="https://example.com/video.mp4",
        output_format="mp3",
        status="converting",
    )
    db_session.add(job)
    db_session.commit()

    response = client.get(f"/api/jobs/{job.id}/download")
    assert response.status_code == 400
    assert "not completed" in response.json()["detail"]


@patch("app.routers.jobs.download_and_convert")
@patch("app.routers.jobs.validate_url_safe")
def test_get_job_status(mock_validate, mock_task, client):
    mock_task.delay.return_value = None
    create_resp = client.post(
        "/api/jobs",
        json={"source_url": "https://example.com/video.mp4", "output_format": "mp4"},
    )
    job_id = create_resp.json()["id"]

    response = client.get(f"/api/jobs/{job_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == job_id
    assert data["status"] == "pending"
    assert data["progress_percent"] == 0
