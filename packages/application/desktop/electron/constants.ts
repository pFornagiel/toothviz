export const BACKEND_HOST = "127.0.0.1";

let activeBackendPort: number | null = null;

export function setBackendPort(port: number): void {
  activeBackendPort = port;
}

export function getBackendPort(): number {
  if (activeBackendPort == null) {
    throw new Error("Backend port has not been allocated yet");
  }
  return activeBackendPort;
}

export function backendBaseUrl(): string {
  return `http://${BACKEND_HOST}:${getBackendPort()}`;
}

export function healthUrl(): string {
  return `${backendBaseUrl()}/storage/health`;
}
