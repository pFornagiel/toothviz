
---

## Running the project (quick reference)

### Desktop app (recommended)

Single command from `packages/application/`:

```bash
cd packages/application
make install          # once: Python deps via uv
make desktop-install  # once: npm deps for frontend + desktop
make desktop-dev      # Electron window + local API on 127.0.0.1:17890
```

**Prerequisites:** Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 20+, npm.

The Electron shell starts the FastAPI backend as a child process and opens the UI. In development, the renderer uses Vite HMR; API calls are proxied to the backend on port **17890**.

User data (SQLite, uploads) is stored under the Electron user data directory, not the git tree.

**Production-style desktop run** (backend serves built UI from one origin):

```bash
cd packages/application/frontend && npm run build
cd ../desktop
TOOTH_SERVE_FRONTEND=1 npm run preview
```

**Packaged build** (requires frontend `dist` and system Python/uv on the machine for MVP):

```bash
cd packages/application
make desktop-dist
```

Installers are written to `packages/application/desktop/release/`.

### Browser dev (optional)

Two terminals for UI-only or debugging without Electron:

**Terminal 1 — backend**

```bash
cd /path/to/tooth
uv sync
cd packages/application
uv run uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**

```bash
cd packages/application/frontend
npm install
npm run dev
```

- App: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- API: [http://127.0.0.1:8000](http://127.0.0.1:8000) (proxied by Vite for `/storage` and `/ws`)

### Backend-only

From `packages/application/`:

```bash
make dev              # normal segmentation, port 8000
make dev-dummy        # fast dummy segmentation
```

OpenAPI docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) (browser workflow) or port 17890 when started by Electron.

SQLite and CAS data:

- **Browser / `make dev`:** `packages/application/data/`
- **Electron:** `~/Library/Application Support/Tooth/data/` (macOS) or equivalent `userData` path

The segmentation pipeline expects an ONNX model at `packages/models/tooth_seg_semantic.onnx`.

### Tests

From the repository root (after `uv sync`):

```bash
pytest
```

Frontend unit tests:

```bash
cd packages/application/frontend
npm run test
```

### Future: bundled Python (not in MVP)

The desktop MVP spawns `uv run uvicorn` and requires Python + uv on the PATH. A later release can bundle the backend with PyInstaller and drop that requirement. See `packages/application/desktop/README.md`.
