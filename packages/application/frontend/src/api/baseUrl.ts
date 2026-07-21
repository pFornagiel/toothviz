/** Resolve an API path against the Electron backend origin when present. */
export function apiUrl(path: string): string {
  const base = window.desktop?.backendBaseUrl?.replace(/\/$/, "") ?? "";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

/** WebSocket URL for a pipeline job (honours Electron backend origin). */
export function pipelineWsUrl(jobId: string): string {
  const base = window.desktop?.backendBaseUrl?.replace(/\/$/, "");
  if (base) {
    const http = new URL(base);
    const protocol = http.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${http.host}/ws/pipeline/${jobId}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/pipeline/${jobId}`;
}
