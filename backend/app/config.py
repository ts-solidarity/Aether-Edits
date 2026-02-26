from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://mediaconv:mediaconv@localhost:5432/mediaconv"
    REDIS_URL: str = "redis://localhost:6379/0"
    MEDIA_DIR: Path = Path(__file__).resolve().parent.parent / "media"
    ALLOWED_ORIGINS: str = "http://localhost:3000"

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


settings = Settings()
