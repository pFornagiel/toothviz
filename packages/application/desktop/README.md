# Tooth desktop (Electron)

Electron shell for the Tooth CBCT app using [electron-vite](https://electron-vite.org/).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + Electron with Vite HMR for the renderer |
| `npm run build` | Compile main, preload, and renderer (`../frontend/dist`) |
| `npm run preview` | Run packaged Electron build locally |
| `npm run dist` | Build OS installers via electron-builder |

## Architecture

- **Main process** spawns `uv run uvicorn backend.app:app` on `127.0.0.1:17890`
- **Dev:** window loads Vite dev server; `/storage` and `/ws` proxy to the backend
- **Production:** window loads the backend URL; FastAPI serves `frontend/dist` when `TOOTH_SERVE_FRONTEND=1`

## Environment variables (set by main process)

| Variable | Purpose |
|----------|---------|
| `TOOTH_DATA_ROOT` | Writable data directory (Electron `userData/data`) |
| `TOOTH_MODEL_PATH` | Path to ONNX model |
| `TOOTH_FRONTEND_DIST` | Path to built React app |
| `TOOTH_SERVE_FRONTEND` | `1` to mount SPA static files on the API server |

## Post-MVP: bundled Python

To ship without a system Python install:

1. Build a PyInstaller one-folder artifact for `uvicorn` + `backend` + dependencies
2. Place it in `extraResources` and spawn it instead of `uv run`
3. Add code signing (macOS notarization, Windows Authenticode)

Expect large installers (300MB+) due to ONNX Runtime and scientific stack.
