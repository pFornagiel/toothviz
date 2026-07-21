import { contextBridge } from "electron";

const BACKEND_URL_ARG = "--tooth-backend-url=";

function readBackendBaseUrl(): string {
  const arg = process.argv.find((a) => a.startsWith(BACKEND_URL_ARG));
  return arg ? arg.slice(BACKEND_URL_ARG.length) : "";
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
