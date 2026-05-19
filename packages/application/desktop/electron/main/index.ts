import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackendManager } from "../backend-manager";
import { backendBaseUrl } from "../constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const backend = new BackendManager();
const isDev = !app.isPackaged;

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, "../preload/index.mjs");

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
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const devRendererUrl = process.env.ELECTRON_RENDERER_URL;
  const backendUrl = `${backendBaseUrl()}/`;

  if (isDev && devRendererUrl) {
    await mainWindow.loadURL(devRendererUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadURL(backendUrl);
  }
}

async function bootstrap(): Promise<void> {
  try {
    await backend.start();
    await createWindow();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start application";
    console.error(message, err);
    dialog.showErrorBox(
      "Tooth — startup failed",
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
