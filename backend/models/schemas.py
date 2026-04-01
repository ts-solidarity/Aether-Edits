from pydantic import BaseModel


class MediaMetadataResponse(BaseModel):
    id: str
    filename: str
    duration: float
    width: int
    height: int
    codec: str | None = None


class ClipDefinition(BaseModel):
    media_id: str
    source_start: float
    source_end: float
    timeline_start: float


class TrackDefinition(BaseModel):
    track_id: str
    clips: list[ClipDefinition]


class ExportRequest(BaseModel):
    tracks: list[TrackDefinition]
    output_format: str = "mp4"


class ExportStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float = 0.0
    error: str | None = None


class HealthResponse(BaseModel):
    status: str
    app: str
