from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from models.database import init_db
from models.schemas import HealthResponse
from routers import media, export


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Montaj", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media.router)
app.include_router(export.router)


@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok", app="montaj")
