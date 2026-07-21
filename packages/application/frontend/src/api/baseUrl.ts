const SESSION_KEY = "toothBackendBaseUrl";
const BACKEND_HOST = "127.0.0.1";

let cachedBaseUrl: string | null = null;

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

function originFromPort(port: string): string | null {
  if (!/^\d+$/.test(port)) {
    return null;
  }
  return `http://${BACKEND_HOST}:${port}`;
}

/**
 * Resolve the local backend origin for Electron (dynamic free port).
 * Order: in-memory cache → preload bridge → URL query → sessionStorage.
 * Query/session cover Windows cases where argv URL/port never reaches preload,
 * and survive client-side navigations that drop the query string.
 */
export function backendOrigin(): string {
  if (cachedBaseUrl != null) {
    return cachedBaseUrl;
  }

  const fromDesktop = window.desktop?.backendBaseUrl?.trim();
  if (fromDesktop) {
    cachedBaseUrl = normalizeOrigin(fromDesktop);
    return cachedBaseUrl;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const port = params.get("toothBackendPort");
    if (port) {
      const origin = originFromPort(port);
      if (origin) {
        cachedBaseUrl = origin;
        sessionStorage.setItem(SESSION_KEY, origin);
        return cachedBaseUrl;
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      cachedBaseUrl = normalizeOrigin(stored);
      return cachedBaseUrl;
    }
  } catch {
    /* ignore */
  }

  cachedBaseUrl = "";
  return cachedBaseUrl;
}

/** Resolve an API path against the Electron backend origin when present. */
export function apiUrl(path: string): string {
  const base = backendOrigin();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

/** WebSocket URL for a pipeline job (honours Electron backend origin). */
export function pipelineWsUrl(jobId: string): string {
  const base = backendOrigin();
  if (base) {
    const http = new URL(base);
    const protocol = http.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${http.host}/ws/pipeline/${jobId}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/pipeline/${jobId}`;
}
