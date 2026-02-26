import client from "./client";

export async function createJob(sourceUrl, outputFormat) {
  const { data } = await client.post("/jobs", {
    source_url: sourceUrl,
    output_format: outputFormat,
  });
  return data;
}

export async function uploadFile(file, outputFormat, onUploadProgress) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("output_format", outputFormat);

  const { data } = await client.post("/jobs/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress,
  });
  return data;
}

export async function getJobStatus(jobId) {
  const { data } = await client.get(`/jobs/${jobId}`);
  return data;
}

export async function getFormats() {
  const { data } = await client.get("/formats");
  return data;
}

export function getDownloadUrl(jobId) {
  return `/api/jobs/${jobId}/download`;
}

export function getStreamUrl(jobId) {
  return `/api/jobs/${jobId}/stream`;
}
