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

- **Main process** allocates a free localhost port, spawns `uv run uvicorn backend.app:app`, and exposes the origin to the renderer via `window.desktop.backendBaseUrl`
- **Dev:** window loads Vite; API/WS calls go to that backend origin (not a fixed port)
- **Production:** window loads the backend URL; FastAPI serves `frontend/dist` when `TOOTH_SERVE_FRONTEND=1`

## Environment variables (set by main process)

| Variable | Purpose |
|----------|---------|
| `TOOTH_DATA_ROOT` | Writable data directory (Electron `userData/data`) |
| `TOOTH_MODEL` | Passed through in dev. `lite_mobile_unet_5ch` (default) or `mobilenetv3_unet_3ch` |
| `TOOTH_MODEL_PATH` | Set for a packaged app to the bundled lite ONNX file. In dev, an explicit path overrides `TOOTH_MODEL` |
| `TOOTH_FRONTEND_DIST` | Path to built React app |
| `TOOTH_SERVE_FRONTEND` | `1` to mount SPA static files on the API server |

## Self-contained installers

`npm run dist` needs Python + uv on the target machine. `packages/installer`
builds installers that bundle a PyInstaller-frozen backend instead. When a
packaged app contains `resources/backend/toothviz-backend`, the main process
spawns it in place of `uv run`. See `packages/installer/README.md`.
