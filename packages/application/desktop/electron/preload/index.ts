import { contextBridge } from "electron";

const BACKEND_PORT_ARG = "--tooth-backend-port=";
const BACKEND_HOST = "127.0.0.1";

/** Port only — full URLs in argv break on Windows (colon parsing). */
function readBackendBaseUrl(): string {
  const arg = process.argv.find((a) => a.startsWith(BACKEND_PORT_ARG));
  if (!arg) {
    return "";
  }
  const port = arg.slice(BACKEND_PORT_ARG.length);
  if (!/^\d+$/.test(port)) {
    return "";
  }
  return `http://${BACKEND_HOST}:${port}`;
}

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** Origin of the local backend (OS-allocated free port each launch). */
  backendBaseUrl: readBackendBaseUrl(),
});
