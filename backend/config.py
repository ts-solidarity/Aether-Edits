from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///./montaj.db"
    UPLOAD_DIR: Path = Path(__file__).parent / "uploads"
    EXPORT_DIR: Path = Path(__file__).parent / "exports"
    MAX_UPLOAD_SIZE_MB: int = 2048
    FFMPEG_TIMEOUT_SECONDS: int = 600
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def upload_path(self) -> Path:
        self.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        return self.UPLOAD_DIR

    @property
    def export_path(self) -> Path:
        self.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        return self.EXPORT_DIR


settings = Settings()
