import pytest
from fastapi import HTTPException

from app.utils.url_validator import validate_url_safe


def test_valid_public_url():
    # Should not raise for public URLs
    # We mock DNS resolution to return a public IP
    import socket
    from unittest.mock import patch

    with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))
        ]
        validate_url_safe("https://example.com/video.mp4")


def test_blocks_private_ip_127():
    import socket
    from unittest.mock import patch

    with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 0))
        ]
        with pytest.raises(HTTPException) as exc_info:
            validate_url_safe("http://localhost/secret")
        assert exc_info.value.status_code == 400
        assert "private" in exc_info.value.detail.lower()


def test_blocks_private_ip_10():
    import socket
    from unittest.mock import patch

    with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("10.0.0.1", 0))
        ]
        with pytest.raises(HTTPException):
            validate_url_safe("http://internal.example.com/data")


def test_blocks_private_ip_192_168():
    import socket
    from unittest.mock import patch

    with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("192.168.1.1", 0))
        ]
        with pytest.raises(HTTPException):
            validate_url_safe("http://router.local/config")


def test_blocks_private_ip_172_16():
    import socket
    from unittest.mock import patch

    with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("172.16.0.1", 0))
        ]
        with pytest.raises(HTTPException):
            validate_url_safe("http://docker.internal/api")


def test_blocks_non_http_scheme():
    with pytest.raises(HTTPException) as exc_info:
        validate_url_safe("ftp://example.com/file")
    assert exc_info.value.status_code == 400


def test_blocks_file_scheme():
    with pytest.raises(HTTPException):
        validate_url_safe("file:///etc/passwd")


def test_blocks_no_hostname():
    with pytest.raises(HTTPException):
        validate_url_safe("http://")
