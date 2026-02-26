import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException


def validate_url_safe(url: str) -> None:
    """Block SSRF attempts by rejecting private/reserved IPs and non-HTTP schemes."""
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only HTTP/HTTPS URLs are allowed")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid URL: no hostname")

    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve hostname")

    for family, _, _, _, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_private or ip.is_reserved or ip.is_loopback or ip.is_link_local:
            raise HTTPException(
                status_code=400,
                detail="URLs pointing to private/internal networks are not allowed",
            )
