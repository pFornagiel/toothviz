export const BACKEND_HOST = "127.0.0.1";
export const BACKEND_PORT = 17890;

export function backendBaseUrl(): string {
  return `http://${BACKEND_HOST}:${BACKEND_PORT}`;
}

export function healthUrl(): string {
  return `${backendBaseUrl()}/storage/health`;
}
