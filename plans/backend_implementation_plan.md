# Backend Implementation Plan — CBCT Image Analysis Application

> [!IMPORTANT]
> This document describes service-layer contracts and method signatures.
> For directory layout, DB schema, and data flows see `architecture_reference.md`.
> For step-by-step build order see `implementation_flow.md`.

---

## Project Structure

```
backend/
├── main.py                   # Process entrypoint
├── app.py                    # FastAPI app factory, lifespan, middleware
├── config.py                 # Settings (paths, chunk size, TTL, model path)
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
│   ├── upload_service.py     # Upload session lifecycle
│   ├── storage_service.py    # CAS commit + FileRecord creation
│   ├── study_service.py      # Study CRUD business logic
│   └── job_pipeline_service.py # JobPipelineService: step routing, dispatch, cancellation
│
├── workers/
│   ├── steps/
│   │   ├── base.py           # PipelineStep protocol, StepContext, StepResult
│   │   ├── dicom_to_nifti.py # DicomToNiftiStep
│   │   └── segment_nifti.py  # SegmentNiftiStep
│   ├── pipeline_runner.py    # run_pipeline() async orchestrator
│   ├── worker_pool.py        # WorkerPool: generic ProcessPoolExecutor wrapper
│   ├── subprocesses/         # Subfolder for pure compute kernels
│   │   ├── dicom_fn.py       # Subprocess fn: convert_dicom(path) → path
│   │   └── segmentation_fn.py# Subprocess fn: run_segmentation(path) → path
│   └── ws_broadcaster.py     # WebSocket registry and broadcast
│
├── db/
│   ├── models.py             # SQLAlchemy ORM models
│   ├── session.py            # Engine and SessionLocal factory
│   └── repos/
│       ├── upload_session_repo.py
│       ├── file_repo.py
│       └── pipeline_job_repo.py
│
└── storage/
    ├── engine.py             # StorageEngine protocol
    └── local_engine.py       # LocalStorageEngine implementation
```

---

## Layer 1 — Database Models

### `UploadSession`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `study_id` | UUID | FK → Study |
| `filename` | string | Original filename |
| `role` | string | `original` |
| `kind` | string | `dicom_zip` / `nifti_raw` / `nifti_mask` |
| `content_type` | string? | MIME type |
| `expected_size` | int? | Total bytes declared by client |
| `expected_sha256` | string? | Hash declared by client for finalize verification |
| `chunk_size` | int | Negotiated chunk size in bytes (returned to client at begin) |
| `state` | string | `active` / `finalized` / `aborted` / `expired` |
| `created_at` | datetime | For TTL expiration |

### `FileRecord`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `study_id` | UUID | FK → Study |
| `pipeline_job_id` | UUID? | FK → PipelineJob (null for originals) |
| `role` | string | `original` / `derived` |
| `kind` | string | `dicom_zip` / `nifti_raw` / `nifti_mask` / `nifti_derived` / `segmentation_mask` |
| `purpose` | string? | `null` / `viewer_volume` / `viewer_overlay` |
| `rel_path` | string | Path relative to data root (used for hardlink resolution) |
| `blob_hash` | string(64) | SHA-256; FK → Blob.hash |
| `content_type` | string? | MIME type |
| `size` | int | Bytes |
| `created_at` | datetime | |
| `meta` | JSON | NIfTI header info (shape, pixdim, affine) if applicable |

> [!IMPORTANT]
> `checksum_sha256` from the POC is **removed** — it was a duplicate of `blob_hash`.
> `purpose=viewer_volume` is set by `UploadService.finalize()` for `nifti_raw` uploads,
> and by `DicomToNiftiStep` for DICOM-derived NIfTI files.
> `purpose=viewer_overlay` is set by `UploadService.finalize()` for `nifti_mask` uploads,
> and by `SegmentNiftiStep` for pipeline-generated masks.
>
> **`kind` provenance:** `nifti_mask` = user-uploaded pre-computed mask (`role=original`); `segmentation_mask` = pipeline-derived mask (`role=derived`).
> **`viewer_overlay` uniqueness:** only one active `viewer_overlay` record per study at a time. New overlays supersede old ones via `StorageService`.

### `PipelineJob`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Returned to client as `job_id` |
| `study_id` | UUID | FK → Study |
| `source_file_id` | UUID | FK → FileRecord that triggers the job |
| `steps` | JSON | Audit log — list of step name strings |
| `status` | string | `queued` / `running` / `completed` / `failed` / `cancelled` |
| `created_at` | datetime | |
| `started_at` | datetime? | |
| `finished_at` | datetime? | |
| `error` | string? | Populated on failure |

> [!NOTE]
> `steps` is an **audit log** only. Step routing is done in Python by `JobPipelineService`,
> not by interpreting the `steps` JSON at runtime.

### Repository Pattern

One thin repo class per model: `UploadSessionRepo`, `FileRepo`, `PipelineJobRepo`.
All raw SQLAlchemy queries live here. Services call repos; routers call services.
Services never return raw ORM objects — they return Pydantic schemas from `schemas.py`.

---

## Layer 2 — Storage Abstraction (`storage/`)

### `StorageEngine` Protocol (`engine.py`)

Defines the interface for all binary I/O operations, decoupling file storage from database logic.

```python
class StorageEngine(Protocol):
    def initialize_upload(self, upload_id: str) -> None: ...
    def write_chunk(self, upload_id: str, index: int, data: bytes) -> None: ...
    def get_chunk_size(self, upload_id: str, index: int) -> int | None: ...
    def list_uploaded_chunks(self, upload_id: str) -> list[int]: ...
    
    def commit_upload_to_cas(self, upload_id: str, expected_sha256: str | None, expected_size: int | None) -> tuple[str, int]: ...
    def commit_file_to_cas(self, src_path: Path) -> tuple[str, int]: ...
    
    def link_file_to_study(self, study_id: str, role: str, filename: str, blob_hash: str) -> Path | str: ...
    def remove_study_data(self, study_id: str) -> None: ...
    def get_job_workspace_dir(self, job_id: str) -> Path: ...
```

### `LocalStorageEngine` (`local_engine.py`)

Implements `StorageEngine` utilizing the local filesystem structure (`data/`).
Handles atomic file moves via `os.replace()`, computes SHA-256 during stitching, and creates hardlinks for study directories.


---

## Layer 3 — Services (`services/`)

### `StorageService`

Combines the `StorageEngine` with Database logic. Used by `UploadService`
(for original uploads) and pipeline step classes (for derived outputs). Holds no request state.

```python
class StorageService:
    def __init__(self, engine: StorageEngine, session_factory: Callable): ...

    def store_original(
        self, upload_id: str, study_id: str,
        filename: str, kind: str, purpose: str | None,
        expected_sha256: str | None, expected_size: int | None,
    ) -> FileRecord:
        """Calls engine.commit_upload_to_cas(), engine.link_file_to_study() + creates FileRecord."""

    def store_derived(
        self, src_path: Path, study_id: str, job_id: str,
        filename: str, kind: str, purpose: str | None,
    ) -> FileRecord:
        """Calls engine.commit_file_to_cas(), engine.link_file_to_study() + creates FileRecord."""
```

`store_original` is called by `UploadService.finalize()`.
`store_derived` is called by `run_pipeline` in `JobPipelineService` at the end of a successful job. Step classes do not call this directly.

**`purpose` supersede:** When a non-null `purpose` (`viewer_volume` or `viewer_overlay`) is passed to either `store_original` or `store_derived`, the method must first null out any existing record for the same study with that identical purpose:
```sql
UPDATE file_records SET purpose = NULL
WHERE study_id = :study_id AND purpose = :purpose
```
This is executed within the same DB transaction as the new `FileRecord` insert, ensuring atomicity.

### `UploadService`

Owns the three-step upload state machine. Injected with `StorageService` and `JobPipelineService`.

**`begin_session(study_id, payload) → {upload_id, chunk_size}`**
Validates study exists, creates `UploadSession(state=active)`, calls `engine.initialize_upload()`, returns negotiated `chunk_size`.

**`write_chunk(upload_id, index, data) → None`**
Validates session is `active`. Calls `engine.get_chunk_size()` for idempotency. Calls `engine.write_chunk()`.

**`get_status(upload_id) → UploadStatusResponse`**
Returns uploaded chunk indices (via `engine.list_uploaded_chunks()`), total uploaded bytes, and session state.

**`finalize(upload_id, pipelines) -> {file_id, job_id | None}`**
1. Calls `storage_service.store_original(...)` — stitches, verifies, commits to CAS, creates `FileRecord`
2. Purpose resolution by kind:
   - `nifti_raw` → `purpose=viewer_volume` (set immediately, before any step runs)
   - `nifti_mask` → `purpose=viewer_overlay` (set immediately; `StorageService` supersedes any prior overlay for the study)
   - `dicom_zip` → `purpose=null` (overlay produced downstream by `DicomToNiftiStep`)
3. Calls `job_pipeline_service.dispatch(file_record, pipelines)` — returns `job_id` or `None`
4. Marks `UploadSession.state = finalized`, removes parts dir
5. Transitions `Study.status`: sets to `processing` if a `job_id` was returned; sets to `ready` if `job_id` is `None` (assuming no other jobs are processing).

`pipelines` is forwarded directly from `FinalizeRequest.pipelines`. When empty (`[]`), no `PipelineJob` is created and `job_id=null` is returned to the client.

### `JobPipelineService`

The single point of entry for all background job execution. Step routing is split into two independent phases:
- **Phase 1 — auto-steps**: derived from `file_record.kind` only, never user-controllable (`DicomToNiftiStep` when `kind="dicom_zip"`).
- **Phase 2 — user steps**: registry-driven loop over the `pipelines` argument. Each `name` is looked up in `self._step_registry` (a `dict[str, StepFactory]` injected at construction); the corresponding factory is called with the item’s `config` dict to produce a step instance. Step names are pre-validated to a `Literal` type by the Pydantic schema, so `dispatch()` can safely index the registry without additional guarding.

If both phases yield no steps, `dispatch` returns `None` and no `PipelineJob` is created.

```python
StepFactory = Callable[[dict], PipelineStep]

class JobPipelineService:
    def __init__(
        self,
        worker_pool: WorkerPool,
        session_factory: Callable,
        storage_service: StorageService,
        broadcaster: WSBroadcaster,
        step_registry: dict[str, StepFactory],  # injected from app.py
    ): ...

    def dispatch(
        self,
        file_record: FileRecord,
        pipelines: list[dict],  # from FinalizeRequest.pipelines
        db,
    ) -> str | None:
        """Build step list, create PipelineJob, fire asyncio task. Returns job_id or None."""
        # Phase 1: auto-steps — determined by file kind, always ordered first
        auto_steps: list[PipelineStep] = []
        if file_record.kind == "dicom_zip":
            auto_steps.append(DicomToNiftiStep())

        # Phase 2: user-requested steps — registry-driven loop
        user_steps: list[PipelineStep] = []
        for item in pipelines:
            factory = self._step_registry[item["name"]]  # names are Literal-validated upstream
            user_steps.append(factory(item.get("config", {})))

        steps = auto_steps + user_steps
        if not steps:
            return None

        job = PipelineJobRepo(db).create(
            study_id=file_record.study_id,
            source_file_id=file_record.id,
            steps=[s.name for s in steps],
        )
        ctx = StepContext(
            job_id=job.id,
            study_id=file_record.study_id,
            current_input_path=cas_blob_path(config.DATA_ROOT, file_record.blob_hash),
            work_dir=job_workspace_dir(config.DATA_ROOT, job.id),
            broadcaster=self._broadcaster,
            _worker_pool=self._worker_pool,
        )
        handle = asyncio.create_task(run_pipeline(job.id, steps, ctx))
        self._running[job.id] = handle
        handle.add_done_callback(lambda _: self._running.pop(job.id, None))
        return job.id

    def cancel(self, job_id: str) -> bool:
        """Cancel in-flight asyncio task. Called by StudyService.delete()."""

    def get_status(self, job_id: str, db) -> PipelineJob:
        return PipelineJobRepo(db).get(job_id)

    async def shutdown(self):
        """Cancel all in-flight tasks and shut down worker pool."""
```

### `StudyService`

Study CRUD. Delete must cancel any active pipeline job before removing files.

**`delete(study_id)`**:
1. Find active `PipelineJob` for this study
2. Call `job_pipeline_service.cancel(job.id)` if found
3. Mark `FileRecord`s deleted in DB
4. Unlink `data/studies/{study_id}/` hardlinks
5. Purge directory (blobs handled by GC separately)

---

## Layer 4 — Workers

### `WorkerPool` (`workers/worker_pool.py`)

Generic, stateless wrapper around `ProcessPoolExecutor`. Has no knowledge of any specific model
or initializer — those are passed in at startup by `app.py`.

```python
class WorkerPool:
    def __init__(
        self,
        max_workers: int = 1,
        initializer: Callable | None = None,
        initargs: tuple = (),
    ):
        self._pool = ProcessPoolExecutor(
            max_workers=max_workers,
            initializer=initializer,
            initargs=initargs,
        )

    async def run(self, fn: Callable, *args) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._pool, fn, *args)

    def shutdown(self, wait: bool = False) -> None:
        self._pool.shutdown(wait=wait)
```

### `StepContext` and protocol (`workers/steps/base.py`)

```python
@dataclass
class StepContext:
    job_id: str
    study_id: str
    current_input_path: Path
    work_dir: Path
    broadcaster: WSBroadcaster
    _worker_pool: WorkerPool = field(repr=False)

    async def run_subprocess(self, fn: Callable, *args) -> Any:
        return await self._worker_pool.run(fn, *args)

@dataclass
class OutputArtifact:
    path: Path
    kind: str
    purpose: str | None

@dataclass
class StepResult:
    next_input_path: Path
    artifacts: list[OutputArtifact]

class PipelineStep(Protocol):
    name: str
    async def run(self, ctx: StepContext) -> StepResult: ...
```

### Step Classes

Each step: inputs `ctx.current_input_path` → outputs to `ctx.work_dir` → `await ctx.run_subprocess(fn, in_path, out_path)` → broadcast → return `StepResult(next_input_path, artifacts)`.

**`DicomToNiftiStep`**: runs `convert_dicom(zip_path)` in subprocess, stores result as `kind=nifti_derived, purpose=viewer_volume`.

**`SegmentNiftiStep`**: runs `run_segmentation(nifti_path)` in subprocess, stores result as `kind=segmentation_mask, purpose=viewer_overlay`.

### Subprocess Functions (pure compute kernels)

**`workers/subprocesses/dicom_fn.py`**: `convert_dicom(input_zip_path: str) -> str` — extracts and converts DICOM ZIP to NIfTI. Returns output path string.

**`workers/subprocesses/segmentation_fn.py`**:
- `_init_segmentation(model_path: str)` — loads ONNX model into module-level global (run once via `initializer=`)
- `run_segmentation(input_nifti_path: str) -> str` — runs inference, returns mask path string

> [!IMPORTANT]
> Only plain strings cross the process boundary. No sessions, services, ORM objects,
> or models are ever pickled. The ONNX model is loaded once per worker process at
> pool startup via `initializer=` — configured in `app.py`, not in `WorkerPool` or step classes.

### `run_pipeline` (`workers/pipeline_runner.py`)

Async orchestrator. Runs steps sequentially, chains `source_blob_hash` from each step's output to
the next step's input. Handles `CancelledError`, exception, and success paths. Updates
`PipelineJob.status` and `Study.status` at each lifecycle point.

```python
async def run_pipeline(job_id: str, steps: list[PipelineStep], ctx: StepContext, storage_service: StorageService):
    ctx.work_dir.mkdir(parents=True, exist_ok=True)
    with storage_service.session_factory() as db:
        PipelineJobRepo(db).set_status(job_id, "running")
    try:
        collected_artifacts: dict[str, OutputArtifact] = {}
        
        for step in steps:
            result = await step.run(ctx)
            ctx = replace(ctx, current_input_path=result.next_input_path)
            
            for artifact in result.artifacts:
                # Deduplicate by purpose. Fallback to kind if purpose is null
                key = artifact.purpose if artifact.purpose else artifact.kind
                collected_artifacts[key] = artifact

        for artifact in collected_artifacts.values():
            storage_service.store_derived(
                src_path=artifact.path,
                study_id=ctx.study_id,
                job_id=job_id,
                filename=artifact.path.name,
                kind=artifact.kind,
                purpose=artifact.purpose
            )

        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "completed")
            StudyRepo(db).set_status(ctx.study_id, "ready")
        await ctx.broadcaster.broadcast(job_id, {"status": "completed"})
    except asyncio.CancelledError:
        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "cancelled")
        raise
    except Exception as exc:
        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "failed", error=str(exc))
        await ctx.broadcaster.broadcast(job_id, {"status": "failed", "error": str(exc)})
    finally:
        shutil.rmtree(ctx.work_dir, ignore_errors=True)
```

### `WSBroadcaster` (`workers/ws_broadcaster.py`)

Registry: `dict[job_id, list[WebSocket]]`. `broadcast(job_id, payload)` called directly from the
async pipeline runner — no `mp.Queue` or drain coroutine needed.

---

## Layer 5 — Routers

Routers are thin. One service call per endpoint. No logic. All responses are Pydantic schemas.

### `studies.py`
- `GET /storage/studies` → `StudyService.list()` (supports `?external_id=` filter)
- `POST /storage/studies` → `StudyService.create()`
- `PATCH /storage/studies/{study_id}` → `StudyService.rename()`
- `DELETE /storage/studies/{study_id}` → `StudyService.delete()`

### `uploads.py`
- `POST /storage/studies/{study_id}/uploads:begin` → `UploadService.begin_session()`
- `PUT /storage/uploads/{upload_id}/chunk?index={i}` → `UploadService.write_chunk()`
- `GET /storage/uploads/{upload_id}/status` → `UploadService.get_status()`
- `POST /storage/uploads/{upload_id}:finalize` → `UploadService.finalize()`

### `files.py`
- `GET /storage/studies/{study_id}/files` — list with optional `?purpose=viewer_volume,viewer_overlay` filter
- `GET /storage/studies/{study_id}/files/{file_id}/content` — `FileResponse` (single GET fetch, natively decompressed by client)

### `ws.py`
- `WS /ws/pipeline/{job_id}` — register, receive loop, unregister on disconnect

---

## Layer 6 — Application Startup (`app.py`)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)       # dev; use Alembic in prod
    # APScheduler for upload TTL cleanup

    worker_pool = WorkerPool(
        max_workers=1,
        initializer=_init_segmentation,
        initargs=(str(config.MODEL_PATH),),
    )
    storage_engine = LocalStorageEngine(config.DATA_ROOT)
    storage_service = StorageService(storage_engine, SessionLocal)
    broadcaster = WSBroadcaster()

    # Step registry: maps pipeline name → factory callable.
    # Adding a new user-requested step only requires a new entry here.
    step_registry: dict[str, StepFactory] = {
        "segment_nifti": lambda cfg: SegmentNiftiStep(config=cfg),
    }

    job_pipeline_service = JobPipelineService(
        worker_pool, SessionLocal, storage_service, broadcaster,
        step_registry=step_registry,
    )

    app.state.job_pipeline_service = job_pipeline_service
    app.state.storage_service = storage_service
    app.state.broadcaster = broadcaster

    yield

    await job_pipeline_service.shutdown()
```

No `mp.Queue`. No drain coroutine.

---

## Implementation Order

```
1.  db/models.py + db/session.py
2.  storage/engine.py (Protocol)
3.  storage/local_engine.py (Implementation)
4.  db/repos/  (all three)
5.  services/storage_service.py
6.  services/upload_service.py
7.  services/study_service.py
8.  routers/uploads.py + routers/files.py + routers/studies.py
9.  workers/ws_broadcaster.py
10. workers/worker_pool.py
11. workers/steps/base.py + workers/pipeline_runner.py
12. workers/subprocesses/dicom_fn.py + workers/subprocesses/segmentation_fn.py
13. workers/steps/dicom_to_nifti.py + workers/steps/segment_nifti.py
14. services/job_pipeline_service.py
15. routers/ws.py
16. app.py lifespan wiring
17. Upload TTL cleanup (APScheduler background task)
18. exceptions.py + config.py consolidation
```

---

## Key Guarantees

**Resumability** — uploads are resumable from the last successful chunk. Client checks status endpoint on reconnect and skips confirmed indices.

**Integrity** — SHA-256 verified at finalize before `FileRecord` is created. Any mismatch raises 422.

**Deduplication** — CAS commit skips blob move if hash already exists. Re-uploads of identical files are free.

**Memory safety** — MONAI/ONNX run in isolated subprocess via `WorkerPool` (backed by `ProcessPoolExecutor`). Cannot crash FastAPI or corrupt the event loop.

**Cancellation** — `JobPipelineService.cancel(job_id)` cancels the in-flight `asyncio.Task`. `StudyService.delete()` always calls this before removing files.

**File serving** — The backend serves the file via `FileResponse`. NiiVue performs a single GET request and handles decompression of `.nii.gz` files internally. No custom chunking or range-request logic is required on either side.

**Pool extensibility** — `WorkerPool` is a generic wrapper; if a second compute type is introduced (e.g., a GPU-accelerated DICOM pipeline), a second `WorkerPool` instance with a different `initializer=` and `max_workers=` can be created in `app.py` and injected into the relevant step classes without changing `JobPipelineService`.

**Overlay uniqueness** — at most one `FileRecord` with `purpose=viewer_overlay` is active per study at a time. `StorageService` atomically nulls any prior overlay before inserting a new one, whether the source is a user-uploaded `nifti_mask` or a pipeline-produced `segmentation_mask`. Last-write-wins.
