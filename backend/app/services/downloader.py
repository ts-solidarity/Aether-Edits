from __future__ import annotations

import logging
from pathlib import Path

import yt_dlp

from app.utils.exceptions import DownloadError

logger = logging.getLogger(__name__)


def download_media(
    url: str,
    output_path: Path,
    progress_callback: callable | None = None,
) -> dict:
    """Download media from URL using yt-dlp.

    Returns a dict with 'ext' (detected extension) and 'title'.
    """
    # Strip extension from output_path since yt-dlp appends its own
    output_template = str(output_path.with_suffix(""))

    ydl_opts = {
        "outtmpl": output_template + ".%(ext)s",
        "format": "bestvideo+bestaudio/best",
        "merge_output_format": "mkv",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }

    if progress_callback:
        def hook(d):
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                if total and total > 0:
                    downloaded = d.get("downloaded_bytes", 0)
                    percent = int((downloaded / total) * 100)
                    progress_callback(min(percent, 100))
            elif d["status"] == "finished":
                progress_callback(100)

        ydl_opts["progress_hooks"] = [hook]

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            ext = info.get("ext", "unknown")
            title = info.get("title", "media")

            # yt-dlp writes to output_template.ext
            actual_path = Path(f"{output_template}.{ext}")
            if not actual_path.exists():
                # Try to find whatever file was written
                parent = output_path.parent
                stem = output_path.stem
                candidates = list(parent.glob(f"{stem}.*"))
                if candidates:
                    actual_path = candidates[0]
                    ext = actual_path.suffix.lstrip(".")
                else:
                    raise DownloadError("Download completed but file not found")

            return {
                "ext": ext,
                "title": title,
                "path": str(actual_path),
            }
    except yt_dlp.utils.DownloadError as e:
        raise DownloadError(f"Failed to download: {e}")
    except Exception as e:
        raise DownloadError(f"Download error: {e}")
