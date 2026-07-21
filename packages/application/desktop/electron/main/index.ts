import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackendManager } from "../backend-manager";
import { getBackendPort } from "../constants";
import {
  installExtension,
  REACT_DEVELOPER_TOOLS,
} from "electron-devtools-installer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const backend = new BackendManager();
const isDev = !app.isPackaged;

backend.setUnexpectedExitHandler(({ code, signal }) => {
  dialog.showErrorBox(
    "Tooth - backend stopped",
    [
      "The local processing service stopped unexpectedly.",
      `code=${code} signal=${signal ?? "none"}`,
      "",
      "Restart the app to continue.",
    ].join("\n"),
  );
  app.quit();
});

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, "../preload/index.mjs");
  const backendUrl = backend.baseUrl();
  const backendPort = getBackendPort();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "Tooth",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Pass port only — full URLs in argv break on Windows (colons).
      additionalArguments: [`--tooth-backend-port=${backendPort}`],
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const devRendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (isDev && devRendererUrl) {
    // Query param is a reliable fallback when preload argv is empty/stripped.
    const sep = devRendererUrl.includes("?") ? "&" : "?";
    await mainWindow.loadURL(
      `${devRendererUrl}${sep}toothBackendPort=${backendPort}`,
    );
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadURL(`${backendUrl}/`);
  }
}

async function installDevtools(): Promise<void> {
  try {
    await installExtension(REACT_DEVELOPER_TOOLS, {
      loadExtensionOptions: { allowFileAccess: true },
    });
  } catch (err) {
    console.warn("Failed to install React DevTools:", err);
  }
}

async function bootstrap(): Promise<void> {
  try {
    if (isDev) {
      await installDevtools();
    }
    await backend.start();
    console.info(`[desktop] backend ready at ${backend.baseUrl()} (port ${getBackendPort()})`);
    await createWindow();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start application";
    console.error(message, err);
    dialog.showErrorBox(
      "Tooth - startup failed",
      `${message}\n\nEnsure Python 3.11+, uv, and backend dependencies are installed (see setup.md).`,
    );
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => bootstrap());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void bootstrap();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    event.preventDefault();
    void backend.stop().finally(() => {
      app.exit(0);
    });
  });
}
