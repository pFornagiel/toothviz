
---

## Running the project (quick reference)

You need **two terminals**: one for the Python API, one for the Vite frontend. Run both from the **repository root** unless noted.

### Prerequisites

- **Python** 3.11+
- **Node.js** 20+ and **npm**

### 1. Backend (FastAPI)

```bash
cd /path/to/tooth
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r pyproject.toml
uvicorn backend.main:app --reload --port 8000
```

- API: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- OpenAPI docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

SQLite and CAS data live under `packages/application/data/` (see `packages/application/backend/config.py`). The segmentation pipeline expects an ONNX model at `packages/models/railnet_dental.onnx` (create or symlink that file if inference is enabled).

### 2. Frontend (Vite + React)

```bash
cd packages/application/frontend
npm install
npm run dev
```

- App: [http://127.0.0.1:5173](http://127.0.0.1:5173)

The dev server proxies `/storage` and `/ws` to `http://localhost:8000`, so keep the backend running on port **8000**.

### 3. Typical workflow

1. Start the backend, then the frontend.
2. Use **Create a Study** or **Browse Studies** in the UI; uploads use chunked `POST/PUT` to `/storage/...` as implemented in the backend.

### Production build (frontend only)

```bash
cd packages/application/frontend
npm run build
```

Serve the `packages/application/frontend/dist` output behind your static host or Electron shell; configure the same origin or CORS/proxy so `/storage` and `/ws` still reach the API.

### Tests

From the repository root (after `pip install -e .`):

```bash
pytest
```
