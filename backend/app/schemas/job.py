from datetime import datetime

from pydantic import BaseModel, HttpUrl


class JobCreateRequest(BaseModel):
    source_url: HttpUrl
    output_format: str


class JobCreateResponse(BaseModel):
    id: str
    status: str


class JobStatusResponse(BaseModel):
    id: str
    source_url: str
    input_format: str | None
    output_format: str
    status: str
    progress_percent: int
    error_message: str | None
    file_size_bytes: int | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
