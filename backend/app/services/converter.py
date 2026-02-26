from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

from app.config import settings
from app.utils.exceptions import ConversionError
from app.utils.formats import AUDIO_FORMATS

logger = logging.getLogger(__name__)


def _get_duration(input_path: str) -> float | None:
    """Use ffprobe to get media duration in seconds."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                input_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None


def convert_media(
    input_path: str,
    output_path: Path,
    output_format: str,
    progress_callback: callable | None = None,
) -> str:
    """Convert media file using FFmpeg. Returns path to converted file."""
    duration = _get_duration(input_path)

    cmd = ["ffmpeg", "-i", input_path, "-y"]

    # Add codec settings based on output format
    if output_format in AUDIO_FORMATS:
        cmd.extend(["-vn"])  # Strip video for audio-only output
        if output_format == "mp3":
            cmd.extend(["-codec:a", "libmp3lame", "-q:a", "2"])
        elif output_format == "aac":
            cmd.extend(["-codec:a", "aac", "-b:a", "192k"])
        elif output_format == "flac":
            cmd.extend(["-codec:a", "flac"])
        elif output_format == "ogg":
            cmd.extend(["-codec:a", "libvorbis", "-q:a", "5"])
    else:
        # Video formats: use reasonable defaults
        if output_format == "mp4":
            cmd.extend(["-codec:v", "libx264", "-preset", "fast", "-crf", "23",
                        "-codec:a", "aac", "-b:a", "192k"])
        elif output_format == "webm":
            cmd.extend(["-codec:v", "libvpx-vp9", "-crf", "30", "-b:v", "0",
                        "-codec:a", "libopus"])

    # Enable progress output
    cmd.extend(["-progress", "pipe:1", str(output_path)])

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        if progress_callback and duration:
            for line in process.stdout:
                if line.startswith("out_time_ms="):
                    try:
                        time_ms = int(line.split("=")[1].strip())
                        time_s = time_ms / 1_000_000
                        percent = int((time_s / duration) * 100)
                        progress_callback(min(percent, 99))
                    except (ValueError, ZeroDivisionError):
                        pass

        process.wait(timeout=settings.FFMPEG_TIMEOUT_SECONDS)

        if process.returncode != 0:
            stderr = process.stderr.read()
            raise ConversionError(f"FFmpeg failed (code {process.returncode}): {stderr[:500]}")

        if not output_path.exists():
            raise ConversionError("Conversion completed but output file not found")

        if progress_callback:
            progress_callback(100)

        return str(output_path)

    except subprocess.TimeoutExpired:
        process.kill()
        raise ConversionError(f"Conversion timed out ({settings.FFMPEG_TIMEOUT_SECONDS}s limit)")
    except ConversionError:
        raise
    except Exception as e:
        raise ConversionError(f"Conversion error: {e}")
