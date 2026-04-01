import asyncio
from pathlib import Path

from models.schemas import TrackDefinition


def build_export_command(
    tracks: list[TrackDefinition],
    media_paths: dict[str, str],
    output_path: Path,
) -> list[str]:
    inputs: dict[str, int] = {}
    input_args: list[str] = []

    all_clips = []
    for track in tracks:
        for clip in track.clips:
            all_clips.append(clip)
            if clip.media_id not in inputs:
                inputs[clip.media_id] = len(inputs)
                input_args.extend(["-i", media_paths[clip.media_id]])

    all_clips.sort(key=lambda c: c.timeline_start)

    filters = []
    concat_parts = []

    for i, clip in enumerate(all_clips):
        idx = inputs[clip.media_id]
        vid = f"v{i}"
        aud = f"a{i}"

        filters.append(
            f"[{idx}:v]trim=start={clip.source_start}:end={clip.source_end},"
            f"setpts=PTS-STARTPTS[{vid}]"
        )
        filters.append(
            f"[{idx}:a]atrim=start={clip.source_start}:end={clip.source_end},"
            f"asetpts=PTS-STARTPTS[{aud}]"
        )
        concat_parts.append(f"[{vid}][{aud}]")

    n = len(all_clips)
    filters.append(
        "".join(concat_parts) + f"concat=n={n}:v=1:a=1[outv][outa]"
    )

    filter_complex = ";".join(filters)

    cmd = [
        "ffmpeg", "-y",
        *input_args,
        "-filter_complex", filter_complex,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        str(output_path),
    ]
    return cmd


async def run_ffmpeg(cmd: list[str], timeout: int = 600) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {stderr.decode()[-500:]}")
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("FFmpeg timed out")
