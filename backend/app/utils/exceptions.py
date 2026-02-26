class DownloadError(Exception):
    """Raised when yt-dlp fails to download media."""
    pass


class ConversionError(Exception):
    """Raised when FFmpeg fails to convert media."""
    pass
