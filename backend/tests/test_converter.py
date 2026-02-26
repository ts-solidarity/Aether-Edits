from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.converter import convert_media
from app.utils.exceptions import ConversionError


@patch("app.services.converter.subprocess")
@patch("app.services.converter._get_duration", return_value=120.0)
def test_convert_success(mock_duration, mock_subprocess, tmp_path):
    output_path = tmp_path / "output.mp3"
    output_path.touch()  # Simulate FFmpeg creating the file

    mock_process = MagicMock()
    mock_process.returncode = 0
    mock_process.stdout = iter([])
    mock_subprocess.Popen.return_value = mock_process

    result = convert_media(
        input_path=str(tmp_path / "input.mkv"),
        output_path=output_path,
        output_format="mp3",
    )
    assert result == str(output_path)


@patch("app.services.converter.subprocess")
@patch("app.services.converter._get_duration", return_value=120.0)
def test_convert_timeout(mock_duration, mock_subprocess, tmp_path):
    import subprocess

    mock_process = MagicMock()
    mock_process.stdout = iter([])
    mock_process.wait.side_effect = subprocess.TimeoutExpired(cmd="ffmpeg", timeout=600)
    mock_subprocess.Popen.return_value = mock_process
    mock_subprocess.TimeoutExpired = subprocess.TimeoutExpired

    output_path = tmp_path / "output.mp4"
    with pytest.raises(ConversionError, match="timed out"):
        convert_media(
            input_path=str(tmp_path / "input.mkv"),
            output_path=output_path,
            output_format="mp4",
        )


@patch("app.services.converter.subprocess")
@patch("app.services.converter._get_duration", return_value=120.0)
def test_convert_failure(mock_duration, mock_subprocess, tmp_path):
    import subprocess

    mock_process = MagicMock()
    mock_process.returncode = 1
    mock_process.stdout = iter([])
    mock_process.stderr.read.return_value = "codec not found"
    mock_subprocess.Popen.return_value = mock_process
    mock_subprocess.TimeoutExpired = subprocess.TimeoutExpired

    output_path = tmp_path / "output.mp4"
    with pytest.raises(ConversionError, match="FFmpeg failed"):
        convert_media(
            input_path=str(tmp_path / "input.mkv"),
            output_path=output_path,
            output_format="mp4",
        )
