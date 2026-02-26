from datetime import datetime

from pydantic import BaseModel, HttpUrl, field_validator

from app.utils.formats import ALL_FORMAT_VALUES


class JobCreateRequest(BaseModel):
    source_url: HttpUrl
    output_format: str

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, v: str) -> str:
        if v not in ALL_FORMAT_VALUES:
            raise ValueError(f"Unsupported format: {v}")
        return v

    @field_validator("source_url")
    @classmethod
    def validate_url_length(cls, v):
        if len(str(v)) > 2048:
            raise ValueError("URL too long (max 2048 characters)")
        return v


class JobCreateResponse(BaseModel):
    id: str
    status: str


class JobStatusResponse(BaseModel):
    id: str
    source_url: str | None
    input_format: str | None
    output_format: str
    status: str
    progress_percent: int
    error_message: str | None
    file_size_bytes: int | None
    source_type: str | None
    original_filename: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
