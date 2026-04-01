import asyncio
import json
from pathlib import Path


async def get_media_metadata(file_path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(file_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {file_path}")

    data = json.loads(stdout)

    video_stream = next(
        (s for s in data.get("streams", []) if s["codec_type"] == "video"),
        None,
    )

    duration = float(data.get("format", {}).get("duration", 0))
    width = int(video_stream.get("width", 0)) if video_stream else 0
    height = int(video_stream.get("height", 0)) if video_stream else 0
    codec = video_stream.get("codec_name", "") if video_stream else ""

    return {
        "duration": duration,
        "width": width,
        "height": height,
        "codec": codec,
    }
