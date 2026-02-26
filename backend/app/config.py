from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://mediaconv:mediaconv@localhost:5432/mediaconv"
    REDIS_URL: str = "redis://localhost:6379/0"
    MEDIA_DIR: Path = Path(__file__).resolve().parent.parent / "media"
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    RATE_LIMIT_PER_HOUR: int = 10
    JOB_TTL_HOURS: int = 24
    MAX_DOWNLOAD_SIZE_MB: int = 500
    FFMPEG_TIMEOUT_SECONDS: int = 600
    CELERY_MAX_RETRIES: int = 3
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    MAX_CONCURRENT_JOBS_PER_IP: int = 3

    class Config:
        env_file = ".env"

    @property
    def downloads_dir(self) -> Path:
        path = self.MEDIA_DIR / "downloads"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def converted_dir(self) -> Path:
        path = self.MEDIA_DIR / "converted"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def uploads_dir(self) -> Path:
        path = self.MEDIA_DIR / "uploads"
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
