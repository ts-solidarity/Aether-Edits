# Cloud-Based Media Converter

Convert media files by pasting a URL. The server downloads with yt-dlp, converts with FFmpeg, and serves the result.

## Prerequisites

- Python 3.11+
- Node.js 18+
- Docker & Docker Compose
- FFmpeg (`sudo apt install ffmpeg` or `brew install ffmpeg`)

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d
```

### 2. Backend setup

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
```

### 3. Run backend services (separate terminals)

```bash
# Terminal 1: API server
cd backend && source venv/bin/activate
uvicorn app.main:app --reload

# Terminal 2: Celery worker
cd backend && source venv/bin/activate
celery -A app.workers.celery_app worker --loglevel=info
```

### 4. Frontend setup

```bash
cd frontend
npm install
npm start
```

### 5. Use it

Open http://localhost:3000, paste a video URL, pick a format, and click Convert.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jobs` | Submit URL + output format |
| GET | `/api/jobs/{id}` | Poll job status |
| GET | `/api/jobs/{id}/download` | Download converted file |
| GET | `/api/formats` | List supported formats |
| GET | `/api/health` | Health check |
