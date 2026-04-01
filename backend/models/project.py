from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, String, Text

from models.database import Base


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id = Column(String(36), primary_key=True)
    project_id = Column(String(36), nullable=True)
    filename = Column(String(255), nullable=False)
    file_path = Column(Text, nullable=False)
    duration = Column(Float, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    codec = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
