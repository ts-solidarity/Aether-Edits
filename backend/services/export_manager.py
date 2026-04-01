from dataclasses import dataclass, field


@dataclass
class ExportJob:
    job_id: str
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    output_path: str | None = None


class ExportManager:
    def __init__(self):
        self._jobs: dict[str, ExportJob] = {}

    def create(self, job_id: str) -> ExportJob:
        job = ExportJob(job_id=job_id)
        self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> ExportJob | None:
        return self._jobs.get(job_id)

    def update(self, job_id: str, **kwargs) -> None:
        job = self._jobs.get(job_id)
        if job:
            for k, v in kwargs.items():
                setattr(job, k, v)


export_manager = ExportManager()
