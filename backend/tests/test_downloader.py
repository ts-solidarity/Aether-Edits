from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.downloader import download_media
from app.utils.exceptions import DownloadError


@patch("app.services.downloader.yt_dlp.YoutubeDL")
def test_download_success(mock_ydl_class, tmp_path):
    output_path = tmp_path / "test.tmp"

    # Create a fake downloaded file
    expected_file = tmp_path / "test.mkv"
    expected_file.touch()

    mock_ydl = MagicMock()
    mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
    mock_ydl.__exit__ = MagicMock(return_value=False)
    mock_ydl.extract_info.return_value = {
        "ext": "mkv",
        "title": "Test Video",
    }
    mock_ydl_class.return_value = mock_ydl

    result = download_media(url="https://example.com/video", output_path=output_path)
    assert result["ext"] == "mkv"
    assert result["title"] == "Test Video"


@patch("app.services.downloader.yt_dlp.YoutubeDL")
def test_download_failure(mock_ydl_class, tmp_path):
    import yt_dlp

    output_path = tmp_path / "test.tmp"

    mock_ydl = MagicMock()
    mock_ydl.__enter__ = MagicMock(return_value=mock_ydl)
    mock_ydl.__exit__ = MagicMock(return_value=False)
    mock_ydl.extract_info.side_effect = yt_dlp.utils.DownloadError("Not found")
    mock_ydl_class.return_value = mock_ydl

    with pytest.raises(DownloadError, match="Failed to download"):
        download_media(url="https://example.com/nonexistent", output_path=output_path)
