import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import treeKill from "tree-kill";
import {
  BACKEND_HOST,
  backendBaseUrl,
  healthUrl,
  setBackendPort,
} from "./constants";
import { allocateFreePort } from "./port";

export type BackendUnexpectedExitHandler = (info: {
  code: number | null;
  signal: NodeJS.Signals | null;
}) => void;

export class BackendManager {
  private proc: ChildProcess | null = null;
  private stopping = false;
  /** True only after start() finished and health passed for *this* child. */
  private ready = false;
  private onUnexpectedExit: BackendUnexpectedExitHandler | null = null;

  setUnexpectedExitHandler(handler: BackendUnexpectedExitHandler | null): void {
    this.onUnexpectedExit = handler;
  }

  baseUrl(): string {
    return backendBaseUrl();
  }

  private applicationRoot(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "application");
    }
    // app.getAppPath() -> .../desktop; parent is packages/application
    return path.resolve(app.getAppPath(), "..");
  }

  private repoRoot(): string {
    return path.resolve(this.applicationRoot(), "../..");
  }

  async start(): Promise<void> {
    if (this.proc) return;

    this.ready = false;
    const port = await allocateFreePort(BACKEND_HOST);
    setBackendPort(port);

    const applicationRoot = this.applicationRoot();
    const repoRoot = this.repoRoot();
    const userData = app.getPath("userData");
    const dataRoot = path.join(userData, "data");
    const frontendDist = path.join(applicationRoot, "frontend", "dist");

    const modelPath = app.isPackaged
      ? path.join(process.resourcesPath, "models", "tooth_seg_semantic.onnx")
      : path.join(repoRoot, "packages", "models", "tooth_seg_semantic.onnx");

    const serveFrontend =
      app.isPackaged || process.env.TOOTH_SERVE_FRONTEND === "1";

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TOOTH_DATA_ROOT: dataRoot,
      TOOTH_MODEL_PATH: modelPath,
      TOOTH_FRONTEND_DIST: frontendDist,
      TOOTH_SERVE_FRONTEND: serveFrontend ? "1" : "0",
      TOOTH_BACKEND_HOST: BACKEND_HOST,
      TOOTH_BACKEND_PORT: String(port),
    };

    const isWin = process.platform === "win32";
    const args = [
      "run",
      "uvicorn",
      "backend.app:app",
      "--host",
      BACKEND_HOST,
      "--port",
      String(port),
    ];

    console.info(`[backend] starting on ${BACKEND_HOST}:${port}`);

    this.proc = spawn("uv", args, {
      cwd: applicationRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWin,
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      console.log("[backend]", chunk.toString().trimEnd());
    });
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      console.error("[backend]", chunk.toString().trimEnd());
    });

    this.proc.on("exit", (code, signal) => {
      const wasReady = this.ready;
      this.ready = false;
      this.proc = null;
      if (!this.stopping) {
        console.error(
          `[backend] exited unexpectedly code=${code} signal=${signal}`,
        );
        if (wasReady) {
          this.onUnexpectedExit?.({ code, signal });
        }
      }
    });

    try {
      await this.waitForHealth();
      this.ready = true;
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  private async waitForHealth(timeoutMs = 120_000): Promise<void> {
    const url = healthUrl();
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (!this.proc) {
        throw new Error(
          `Backend process exited before becoming healthy at ${url}.`,
        );
      }
      try {
        const res = await fetch(url);
        if (res.ok) return;
      } catch {
        // retry until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Backend did not become healthy at ${url}`);
  }

  async stop(): Promise<void> {
    if (!this.proc?.pid || this.stopping) return;
    this.stopping = true;
    this.ready = false;
    const pid = this.proc.pid;

    await new Promise<void>((resolve) => {
      treeKill(pid, "SIGTERM", (err) => {
        if (err) {
          this.proc?.kill("SIGTERM");
        }
        resolve();
      });
    });

    this.proc = null;
    this.stopping = false;
  }
}
