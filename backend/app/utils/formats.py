SUPPORTED_FORMATS = {
    "video": [
        {"value": "mp4", "label": "MP4"},
        {"value": "webm", "label": "WebM"},
        {"value": "mkv", "label": "MKV"},
        {"value": "avi", "label": "AVI"},
        {"value": "mov", "label": "MOV"},
    ],
    "audio": [
        {"value": "mp3", "label": "MP3"},
        {"value": "aac", "label": "AAC"},
        {"value": "wav", "label": "WAV"},
        {"value": "flac", "label": "FLAC"},
        {"value": "ogg", "label": "OGG"},
    ],
}

ALL_FORMAT_VALUES = {
    fmt["value"]
    for group in SUPPORTED_FORMATS.values()
    for fmt in group
}

AUDIO_FORMATS = {fmt["value"] for fmt in SUPPORTED_FORMATS["audio"]}
VIDEO_FORMATS = {fmt["value"] for fmt in SUPPORTED_FORMATS["video"]}
