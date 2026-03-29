# Backend Implementation Plan — CBCT Image Analysis Application

This document defines the structure and implementation plan for the FastAPI backend, covering the API layer, service layer, background workers, and storage architecture.

---

## Project Structure

The backend is organized into six top-level packages, each with a single responsibility.

```
backend/
├── main.py                   # Process entrypoint
├── app.py                    # FastAPI app factory, lifespan, middleware
├── config.py                 # Settings (paths, chunk size, TTL, etc.)
├── schemas.py                # Shared Pydantic request/response models
├── exceptions.py             # Custom HTTP exceptions
│
├── routers/
│   ├── studies.py            # Study CRUD endpoints
│   ├── uploads.py            # Chunked upload state machine endpoints
│   ├── files.py              # File content retrieval
│   └── ws.py                 # WebSocket progress endpoint
│
├── services/
│   ├── upload_service.py     # Upload session lifecycle orchestration
│   ├── storage_service.py    # CAS commit and derived file persistence
│   ├── pipeline_service.py   # Job creation and scheduler dispatch
│   └── study_service.py      # Study CRUD business logic
│
├── workers/
│   ├── scheduler.py          # APScheduler + ProcessPoolExecutor wrapper
│   ├── ws_broadcaster.py     # WebSocket connection registry and broadcast
│   ├── dicom_worker.py       # DICOM-to-NIfTI conversion subprocess
│   └── segmentation_worker.py # MONAI inference subprocess
│
├── db/
│   ├── models.py             # SQLAlchemy ORM models
│   ├── session.py            # Engine and session factory
│   └── repos/
│       ├── upload_session_repo.py
│       ├── file_repo.py
│       └── pipeline_job_repo.py
│
└── storage/
    ├── cas.py                # Content-Addressed Storage commit logic
    ├── upload_session.py     # Chunk I/O and resume support
    └── paths.py              # Pure-function path computation (no I/O)
```

---

## Layer 1 — Database Models (`db/`)

Start here. Everything else depends on these three shapes.

### `UploadSession`

Represents an in-progress chunked upload. The `state` column is the only thing routers need to check before accepting a chunk or a finalize call.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `study_id` | UUID | Foreign key to study |
| `filename` | string | Original filename |
| `role` | string | `original` or `derived` |
| `kind` | string | `nifti`, `dicom_zip`, `segmentation` |
| `expected_size` | int | Total bytes declared by client |
| `expected_sha256` | string | Hash declared by client for verification |
| `state` | enum | `active`, `finalized`, `aborted`, `expired` |
| `chunk_size` | int | Negotiated chunk size in bytes |
| `created_at` | datetime | For TTL expiration |

### `FileRecord`

The durable, permanent record for any file that has been committed to CAS. This is what NiiVue references when fetching content.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `study_id` | UUID | Foreign key |
| `upload_session_id` | UUID | Nullable FK (null for derived files created by workers) |
| `pipeline_job_id` | UUID | Nullable FK (set for derived files) |
| `role` | string | `original` or `derived` |
| `kind` | string | `nifti`, `dicom_zip`, `segmentation` |
| `cas_hash` | string | SHA-256 hash, used to locate the blob |
| `filename` | string | Human-readable name |
| `size_bytes` | int | Verified size after CAS commit |

### `PipelineJob`

Tracks the execution state of any background processing task, whether a DICOM conversion or a full segmentation pipeline.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | This is the `task_id` returned to the client |
| `study_id` | UUID | Foreign key |
| `source_file_id` | UUID | The `FileRecord` that triggers this job |
| `steps` | JSON | Array of `{name, config}` objects |
| `status` | enum | `queued`, `running`, `completed`, `failed` |
| `created_at` | datetime | |
| `started_at` | datetime | Nullable, set when worker begins |
| `finished_at` | datetime | Nullable, set on completion or failure |
| `error` | string | Nullable, populated on failure |

### Repository pattern

Create a thin repository class for each model: `UploadSessionRepo`, `FileRepo`, and `PipelineJobRepo`. These wrap all raw SQLAlchemy queries. Routers and services must never import `Session` directly — they always go through the repo. This makes services easy to test in isolation by passing a mock repo.

---

## Layer 2 — Storage (`storage/`)

### `paths.py` — pure path computation

A module of pure functions with no I/O and no imports from the rest of the application. Centralizing path logic here prevents the "where is this file actually stored?" question from sprawling across multiple modules.

Key functions:
- `upload_parts_dir(upload_id: str) -> Path` — returns `data/uploads/{upload_id}/parts/`
- `cas_blob_path(sha256_hash: str) -> Path` — returns `data/blobs/sha256/{hash[:2]}/{hash}`
- `study_raw_link(study_id: str, filename: str) -> Path` — returns `data/studies/{study_id}/raw/{filename}`
- `study_derived_link(study_id: str, filename: str) -> Path` — returns `data/studies/{study_id}/derived/{filename}`

### `cas.py` — Content-Addressed Storage

Contains the single most critical function in the storage layer: `commit_to_cas(parts_dir, expected_sha256, expected_size) -> (actual_hash, blob_path)`.

The function stitches all ordered chunk files from `parts_dir` into a single `concat.tmp` file, computes the SHA-256 hash of the result, and validates both the hash and the size against the client's declared expectations. On success, it calls `os.rename()` for an atomic move into `data/blobs/sha256/{xx}/{hash}` — the rename is atomic on POSIX systems, which prevents partial writes from appearing as valid blobs.

If a blob with the same hash already exists, the move is skipped entirely. This is the deduplication guarantee. After committing, the function creates a hardlink under the appropriate study directory using `paths.study_raw_link()`.

### `upload_session.py` — chunk I/O

Handles writing individual chunk files named `part_{i:06d}.chunk`, reading back an individual chunk's size on disk for idempotency checks, and listing all existing chunk indices so the resume status endpoint can report which chunks are still missing.

---

## Layer 3 — Services (`services/`)

The orchestration layer. Routers call services; services call repos and the storage layer. Services must never return raw ORM objects to routers — they return Pydantic response schemas defined in `schemas.py`.

### `UploadService`

Owns the three-step upload state machine.

**`begin_session(study_id, payload)`** — validates the study exists in the database, creates an `UploadSession` record with state `active`, creates the parts directory on disk, and returns the `upload_id` and negotiated `chunk_size` to the router.

**`write_chunk(upload_id, index, data)`** — validates that the session is still `active` (raises 404 if expired or finalized). Checks idempotency: if the chunk file already exists and its size on disk matches `len(data)`, returns immediately with 200 OK — this lets the client safely retry without corrupting the upload. If the chunk exists with a different size, raises 409 Conflict. Otherwise, writes the chunk file.

**`get_status(upload_id)`** — calls `upload_session.list_uploaded_chunks()` and returns the list of uploaded indices, total uploaded bytes, and session state. Used by the client to resume an interrupted upload.

**`finalize(upload_id, pipeline_steps)`** — calls `cas.commit_to_cas()`, creates a `FileRecord` in the database, marks the `UploadSession` as `finalized`, deletes the temporary parts directory, and then delegates to `PipelineService.dispatch_if_needed()`. Returns the new `file_id` and `task_id` to the router.

### `StorageService`

A simpler helper used by background workers to persist derived outputs back to the CAS. The single key method is `store_derived_file(study_id, job_id, local_path, kind)`, which computes the file's hash, moves it into the CAS, creates a `FileRecord` with `role=derived`, and creates a hardlink under `data/studies/{study_id}/derived/`. Workers call this at the very end of their pipeline before emitting the completion WebSocket message.

### `PipelineService`

Handles job creation and scheduler dispatch.

**`dispatch_if_needed(file_record, requested_steps)`** — inspects the `file_record.kind`. If it is `dicom_zip`, it prepends `{name: "dicom_to_nifti", config: {}}` to the front of the `requested_steps` array before any user-requested steps. This normalization step ensures DICOM data is always converted before downstream tools like MONAI attempt to consume it. The method then creates a `PipelineJob` row in the database and calls `scheduler.enqueue(job)`. If no steps are requested and the file is not a DICOM zip, no job is created and the method returns `None`.

**`get_job_status(task_id)`** — a direct pass-through to `PipelineJobRepo.get(task_id)`, used by the status polling endpoint.

### `StudyService`

Handles study CRUD operations. The delete operation must cascade: it marks associated `FileRecord`s as deleted in the database, removes the study's hardlinks from `data/studies/{study_id}/`, and purges the directory. It does not delete CAS blobs, since other studies may reference the same content. A separate maintenance job (see cleanup worker below) is responsible for identifying and purging orphaned blobs with no DB references.

---

## Layer 4 — Workers (`workers/`)

### `scheduler.py`

Wraps APScheduler configured with a `ProcessPoolExecutor`. A process pool — not a thread pool — is essential here. MONAI and PyTorch allocate large amounts of GPU/CPU memory and are not safe to run in threads sharing the same Python interpreter as FastAPI. Each worker job runs in a fully isolated subprocess.

The module exposes two functions: `enqueue(job: PipelineJob) -> None`, which serializes the job config to a plain dict and submits it to the pool, and `shutdown()`, which drains the queue and waits for in-flight jobs to complete. The scheduler is responsible for updating `PipelineJob.status` to `running` immediately before dispatching and writing back `completed` or `failed` after the subprocess returns.

### `ws_broadcaster.py`

Maintains a module-level registry of the form `dict[task_id, list[WebSocket]]`. The broadcaster exposes three functions: `register(task_id, ws)` called when a client opens a WebSocket connection, `unregister(task_id, ws)` called on disconnect, and `broadcast(task_id, payload: dict)` which is an `async` coroutine that iterates over all registered connections for a given `task_id` and sends the JSON payload.

**The critical architectural seam:** worker subprocesses cannot call `broadcast()` directly because they run in separate processes and cannot access the FastAPI event loop. Instead, workers write structured progress dicts onto a `multiprocessing.Queue`. A long-running background coroutine started in `app.py` on startup drains this queue in a loop using `asyncio.get_event_loop().run_in_executor()` and forwards each message to `broadcaster.broadcast()`. This is the bridge between the subprocess world and the async FastAPI world.

### `dicom_worker.py`

A plain Python function (not async) that accepts a serialized job config dict. It opens the `dicom_zip` blob from the CAS path, extracts the archive to a temporary directory, and runs the conversion using `dicom2nifti` or `SimpleITK`. Progress messages are put onto the shared queue at key milestones in the form `{"task_id": ..., "status": "running", "progress": 42.5, "step": "dicom_to_nifti"}`. On success, it calls `StorageService.store_derived_file()` and emits a `completed` message with the new `file_id`. On any exception, it emits a `failed` message with the error string and updates the `PipelineJob` status in the database.

### `segmentation_worker.py`

Follows the same pattern as `dicom_worker`. Accepts the job config, loads the source NIfTI from CAS, applies the preprocessing pipeline (resampling, intensity normalization), and runs MONAI inference with the bundled model weights. Emits granular progress messages through the shared queue at each pipeline stage. On completion, stores the binary segmentation mask via `StorageService.store_derived_file()` and emits the final `completed` WebSocket event.

---

## Layer 5 — Routers (`routers/`)

Routers are intentionally thin. They validate input via Pydantic schemas, call exactly one service method, and return the response. No logic lives in routers. If you find yourself writing an `if` statement in a router, it belongs in a service instead.

### `studies.py`
- `GET /storage/studies` — list all studies, delegates to `StudyService.list()`
- `POST /storage/studies` — create study, validates name uniqueness, delegates to `StudyService.create()`
- `PATCH /storage/studies/{study_id}` — rename, delegates to `StudyService.rename()`
- `DELETE /storage/studies/{study_id}` — cascading delete, delegates to `StudyService.delete()`

### `uploads.py`
- `POST /storage/studies/{study_id}/uploads:begin` — delegates to `UploadService.begin_session()`
- `PUT /storage/uploads/{upload_id}/chunk?index={i}` — delegates to `UploadService.write_chunk()`
- `GET /storage/uploads/{upload_id}/status` — delegates to `UploadService.get_status()`, supports resume
- `POST /storage/uploads/{upload_id}:finalize` — delegates to `UploadService.finalize()`

### `files.py`
- `GET /storage/studies/{study_id}/files/{file_id}/content` — looks up the `FileRecord`, resolves the path via `paths.cas_blob_path()` or the study hardlink, and returns `FileResponse`. FastAPI's `FileResponse` natively handles `Range` headers and returns 206 Partial Content automatically — no custom streaming code is required. This is what allows NiiVue to fetch only the NIfTI header or a specific slice without downloading the entire file.

### `ws.py`
- `WS /ws/pipeline/{task_id}` — accepts the WebSocket upgrade, validates that the `task_id` exists in the database, calls `broadcaster.register(task_id, ws)`, and then enters an infinite receive loop that only exits on disconnect, at which point it calls `broadcaster.unregister(task_id, ws)`.

---

## Layer 6 — Application Startup (`app.py`)

The composition root. Kept small — it wires things together but contains no logic.

On **startup** (using FastAPI's `lifespan` context manager):
1. Run database migrations via Alembic, or call `Base.metadata.create_all()` for development.
2. Start the APScheduler instance.
3. Create the shared `multiprocessing.Queue` for worker-to-broadcaster messages.
4. Launch the background asyncio task that drains the queue and forwards messages to `ws_broadcaster.broadcast()`.

On **shutdown**:
1. Signal the drain task to stop and wait for it to flush remaining messages.
2. Call `scheduler.shutdown()` and wait for in-flight jobs.

---

## Suggested Implementation Order

Building in this sequence keeps the system testable and runnable at each step, with no dead-end dependencies.

1. `db/models.py` and `db/session.py` — the foundation everything else depends on
2. `storage/paths.py` and `storage/cas.py` — no dependencies, easily unit-tested
3. `storage/upload_session.py` — chunk I/O utilities
4. `db/repos/` — thin wrappers around the models
5. `services/upload_service.py` and `services/storage_service.py` — core upload path
6. `routers/uploads.py` and `routers/files.py` — first testable HTTP surface
7. `workers/scheduler.py` and `workers/ws_broadcaster.py` — async infrastructure
8. `services/pipeline_service.py` — job creation and dispatch
9. `workers/dicom_worker.py` — DICOM conversion
10. `workers/segmentation_worker.py` — MONAI inference
11. `routers/ws.py` — WebSocket endpoint, depends on broadcaster
12. `services/study_service.py` and `routers/studies.py` — CRUD, can slot in any time after step 4

---

## Key Guarantees

**Fault tolerance** — uploads are resumable from the last successful chunk. The client checks the status endpoint on reconnect and skips already-confirmed indices.

**Data integrity** — SHA-256 verification during finalization ensures the file written to CAS is byte-for-byte identical to what the client sent. Any mismatch raises a 422 before the `FileRecord` is created.

**Deduplication** — the CAS commit skips the blob move if a file with the same hash already exists, making re-uploads of identical files free.

**Memory safety** — workers run in isolated subprocesses, so MONAI/PyTorch memory pressure cannot crash the FastAPI process or corrupt the event loop.

**Bandwidth efficiency** — `FileResponse` with range request support allows NiiVue to fetch only the NIfTI headers or specific slices rather than downloading entire volumes, which can be hundreds of megabytes.
