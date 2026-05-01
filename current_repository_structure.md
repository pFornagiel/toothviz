# Current Repository Structure and Runtime Architecture

## 1. Repository Overview

```text
tooth/
|-- README.md
|-- setup.md
|-- pyproject.toml
|-- notes/
|-- plans/
|-- packages/
|   |-- application/
|   |   |-- backend/
|   |   |-- frontend/
|   |   |-- data/
|   |   |-- logs/
|   |   |-- test_files/
|   |   `-- tests/
|   |-- models/
|   `-- prototyping/
`-- .python-version
```

### Top-level areas

| Path | Purpose |
|---|---|
| `README.md` | Short thesis/project summary and high-level folder description. |
| `setup.md` | Practical run instructions for backend, frontend, and tests. |
| `pyproject.toml` | Python project metadata, runtime dependencies, pytest config, and package discovery. |
| `notes/` | Research notes, thesis material, links, and internal meeting notes. Mostly project knowledge, not runtime code. |
| `packages/application/` | Main proof-of-concept application: FastAPI backend, Vite/React frontend, runtime data, tests, and sample files. |
| `packages/models/` | ML model assets, currently including `railnet_dental.onnx`. |
| `packages/prototyping/` | Earlier proof-of-concept experiments for file storage, ML worker execution, and database access. |

## 2. Python Project Configuration

The Python project is configured from `pyproject.toml`.

Runtime dependencies currently include:

| Dependency | Role |
|---|---|
| `fastapi`, `uvicorn[standard]` | HTTP API, WebSocket endpoint, and local dev server. |
| `sqlalchemy` | ORM and SQLite database access. |
| `pydantic` | Request and response schemas. |
| `python-multipart` | Request body support for API usage. |
| `nibabel`, `scipy`, `onnxruntime` | NIfTI processing and ONNX segmentation pipeline support. |

The package discovery path includes both `packages/prototyping` and `packages/application`, while pytest is scoped to `packages/application/tests`.

## 3. Main Application Layout

```text
packages/application/
|-- backend/
|-- frontend/
|-- data/
|-- logs/
|-- test_files/
`-- tests/
```

| Path | Purpose |
|---|---|
| `backend/` | FastAPI application, database models/repos, storage engine, services, routers, and worker pipeline. |
| `frontend/` | Vite + React UI for creating, browsing, uploading, and visualizing studies. |
| `data/` | Runtime SQLite DB, CAS blobs, upload chunks, study file links, and temporary job workspaces. Created/used by the backend. |
| `logs/` | Runtime logs if produced by local execution. |
| `test_files/` | Sample files used manually or by tests, including NIfTI and DICOM samples. |
| `tests/` | Unit and integration tests for backend, frontend-adjacent API behavior, and older PoCs. |

## 4. Backend Layout

```text
packages/application/backend/
|-- app.py
|-- main.py
|-- config.py
|-- exceptions.py
|-- schemas.py
|-- db/
|   |-- models.py
|   |-- session.py
|   `-- repos/
|-- routers/
|-- services/
|-- storage/
|-- utils/
`-- workers/
```

| Path | Purpose |
|---|---|
| `app.py` | FastAPI app factory and lifespan wiring. Creates DB tables, storage, services, worker pool, and routers. |
| `main.py` | Uvicorn entry point that exposes the FastAPI app. |
| `config.py` | Central paths and constants: chunk size, data root, SQLite URL, model path, CAS prefix length. |
| `exceptions.py` | Application error classes mapped to HTTP status codes. |
| `schemas.py` | Pydantic API request and response models. |
| `db/models.py` | SQLAlchemy models for studies, file records, upload sessions, and pipeline jobs. |
| `db/session.py` | SQLAlchemy engine and `SessionLocal`, including SQLite pragmas. |
| `db/repos/` | Repository layer around database reads/writes. |
| `routers/` | FastAPI route modules for studies, uploads, files, and WebSocket pipeline updates. |
| `services/` | Business logic layer used by routers. |
| `storage/` | Storage protocol and local filesystem implementation. |
| `utils/status.py` | Shared status mapping used by API responses. |
| `workers/` | Pipeline runner, process pool, WebSocket broadcaster, pipeline steps, and subprocess compute functions. |

## 5. Backend Startup and Dependency Wiring

Startup is defined in `backend/app.py` through the FastAPI lifespan context.

The current startup sequence is:

1. Create all SQLAlchemy tables with `Base.metadata.create_all(engine)`.
2. Build `LocalStorageEngine` using `config.DATA_ROOT`.
3. Wrap it in `StorageService`.
4. Create a `WSBroadcaster`.
5. Abort lingering `UploadSession` rows that are still `active` from a previous run.
6. Run a CAS orphan sweep as a startup failsafe.
7. Start a `WorkerPool` with one process and initialize the ONNX segmentation model inside that process.
8. Build the pipeline step registry. At the moment, the user-facing pipeline registry exposes `segment_nifti`.
9. Create `JobPipelineService`, `StudyService`, and `UploadService`.
10. Attach the services and broadcaster to `app.state`.
11. Register routers for studies, uploads, files, and WebSockets.

On shutdown, `JobPipelineService.shutdown()` cancels in-flight jobs and shuts down the process pool.

## 6. Configuration

`backend/config.py` defines the important runtime constants:

| Setting | Current value / meaning |
|---|---|
| `DEFAULT_CHUNK_SIZE` | `16 * 1024 * 1024`, so uploads are chunked at 16 MB by default. |
| `DATA_ROOT` | `packages/application/data`. |
| `STORAGE_DB_URL` | SQLite database at `packages/application/data/cbct.db`. |
| `MODEL_PATH` | `packages/models/railnet_dental.onnx`. |
| `CAS_BLOB_HASH_LENGTH` | `2`, so CAS blobs are partitioned by the first two hash characters. |

## 7. Database Models

The current backend uses four SQLAlchemy ORM models.

### `Study`

`Study` is the user-visible persistent workspace.

| Field | Meaning |
|---|---|
| `id` | UUID string primary key. |
| `name` | Optional study name, indexed for name filtering. |
| `created_at` | UTC timestamp. |

Relationships:

| Relationship | Meaning |
|---|---|
| `files` | One study has many `FileRecord` rows. Cascade delete removes file records when a study is deleted. |
| `pipeline_job` | One study has one `PipelineJob`. Cascade delete removes the job when the study is deleted. |

### `FileRecord`

`FileRecord` is the database pointer from a study to a CAS blob and to a user-facing/study-facing file path.

| Field | Meaning |
|---|---|
| `id` | UUID string primary key. |
| `study_id` | FK to `studies.id`, cascade deleted with the study. |
| `kind` | File classification such as `dicom_zip`, `nifti_raw`, `nifti_mask`, `nifti_derived`, or `segmentation_mask`. |
| `viewer_purpose` | Viewer slot. `viewer_volume` is the active base volume; `viewer_overlay` is the active mask/overlay. `NULL` means not directly selected for viewer loading. |
| `display_name` | Filename shown to users and used under the study file path. |
| `blob_hash` | SHA-256 content hash pointing to the immutable CAS blob. Indexed. |
| `size` | File size in bytes. |
| `created_at` | UTC timestamp. |

Important indexes and constraints:

| Index / constraint | Meaning |
|---|---|
| `ix_file_records_study_id` | Speeds up listing files for a study. |
| `ix_file_records_study_viewer_purpose` | Speeds up filtering by viewer purpose. |
| `uq_file_records_study_viewer_purpose_active` | Partial unique SQLite index over `(study_id, viewer_purpose)` where `viewer_purpose IS NOT NULL`. This enforces at most one active file per viewer slot per study. |

The unique viewer-purpose rule is paired with repository/service behavior: before a new file is inserted for a non-null `viewer_purpose`, existing rows for that same study and purpose are cleared to `NULL`. This preserves history while making only the latest relevant file active for the viewer.

### `UploadSession`

`UploadSession` tracks a chunked upload before it is committed into CAS.

| Field | Meaning |
|---|---|
| `id` | UUID string primary key and upload directory name. |
| `study_id` | Study receiving the upload. |
| `filename` | Original client filename. |
| `kind` | Upload kind: `dicom_zip`, `nifti_raw`, or `nifti_mask`. |
| `state` | Upload lifecycle state, currently `active`, `finalized`, or `aborted`. |
| `created_at` | UTC timestamp. |

Startup aborts lingering `active` sessions and removes their temporary chunks.

### `PipelineJob`

`PipelineJob` tracks the processing state for a study. The current design is one job row per study.

| Field | Meaning |
|---|---|
| `id` | UUID string primary key. |
| `study_id` | Unique FK to `studies.id`; enforces one pipeline job per study. |
| `source_file_id` | FK to the source `FileRecord`; nullable and set to `NULL` if the source file is deleted. |
| `steps` | JSON list of step names prepared for the current/last dispatch. |
| `status` | Internal job status such as `created`, `queued`, `running`, `ready`, `completed`, `failed`, or `cancelled`. |
| `created_at` | UTC timestamp. |
| `error` | Error message for failed jobs. |

`PipelineJob` is created when a `Study` is created. Dispatch reuses the study's singleton job row by updating `steps`, setting status to `queued`, and clearing any previous error.

## 8. Database Session Behavior

`backend/db/session.py` builds the SQLAlchemy engine from `config.STORAGE_DB_URL`.

For SQLite, it enables:

| PRAGMA | Purpose |
|---|---|
| `journal_mode=WAL` | Better concurrent read/write behavior for local app usage. |
| `synchronous=NORMAL` | Balanced durability/performance setting for WAL mode. |
| `foreign_keys=ON` | Enforces FK cascade and `ON DELETE SET NULL` behavior. |

`SessionLocal` is created with `expire_on_commit=False`, which lets services return ORM objects after commits without immediate expiration.

## 9. Repository Layer

Repositories live in `backend/db/repos/` and are thin data-access wrappers used by services and routers.

| Repository | Responsibility |
|---|---|
| `StudyRepo` | Create, get, list, rename, delete studies; load study with its pipeline job via `selectinload`. |
| `FileRepo` | Create file records, list by study, filter by viewer purpose, get by ID, clear viewer purpose, count blob references, delete all files for a study. |
| `UploadSessionRepo` | Create/get upload sessions, list by state, update state. |
| `PipelineJobRepo` | Create singleton job for a study, get jobs, prepare dispatch, set status, find active jobs. |

Important current behavior:

- `FileRepo.clear_viewer_purpose(study_id, viewer_purpose)` sets old active viewer rows to `NULL` before a replacement record is inserted.
- `FileRepo.count_references(blob_hash)` is used during study deletion to delete CAS blobs only when no database records still reference the content.
- `PipelineJobRepo.prepare_dispatch(...)` mutates the existing per-study job into a queued job rather than inserting a new job row.

## 10. Storage and CAS

Storage is split into a protocol and a local implementation.

| File | Role |
|---|---|
| `backend/storage/engine.py` | `StorageEngine` protocol. Defines upload, CAS, path, linking, cleanup, and GC operations. |
| `backend/storage/local_engine.py` | Local filesystem implementation. |
| `backend/services/storage_service.py` | Higher-level service that combines storage engine operations with `FileRecord` creation. |

### Runtime data layout

The local engine stores data under `packages/application/data`.

```text
packages/application/data/
|-- cbct.db
|-- blobs/
|   `-- sha256/
|       `-- {hash_prefix}/
|           `-- {full_sha256}
|-- uploads/
|   `-- {upload_id}/
|       |-- concat.tmp
|       `-- parts/
|           `-- part_00000000.chunk
|-- studies/
|   `-- {study_id}/
|       `-- files/
|           `-- {file_id}/
|               `-- {display_name}
`-- tmp/
    `-- jobs/
        `-- {job_id}/
```

### CAS write path

`LocalStorageEngine.commit_upload_to_cas(...)` performs the upload commit:

1. Read uploaded chunks from `uploads/{upload_id}/parts`.
2. Concatenate chunks into `concat.tmp`.
3. Stream the content through SHA-256 while writing.
4. Validate `expected_size` when provided.
5. Validate `expected_sha256` when provided. The current API path passes `None` for checksum, but the engine supports it.
6. Move the temp file into `blobs/sha256/{prefix}/{full_hash}` if the blob does not already exist.
7. If the blob already exists, delete the temp file and reuse the existing content.
8. Return `(blob_hash, size)`.

`LocalStorageEngine.commit_file_to_cas(...)` performs the same content-addressing flow for files already present on disk, such as pipeline output artifacts.

### Study file links

The CAS blob is immutable and content-addressed. User/study-facing paths are created separately:

```text
studies/{study_id}/files/{file_id}/{display_name}
```

`link_study_file(...)` tries to hardlink the CAS blob into that study path. If hardlinking fails, it falls back to `shutil.copy2`. This keeps the viewer and download endpoints on stable, filename-oriented paths while keeping the canonical content under CAS.

### CAS deduplication

Deduplication is automatic because the blob path is derived from SHA-256. Two uploads with identical bytes produce the same `blob_hash` and point to the same CAS object. They can still have separate `FileRecord` rows and separate study-facing paths.

### CAS cleanup

There are two cleanup mechanisms:

| Mechanism | Trigger | Behavior |
|---|---|---|
| Study deletion cleanup | `StudyService.delete(...)` | Deletes file records and study directory, then deletes any blob whose hash now has zero DB references. |
| Orphan sweep | App startup or `StorageService.sweep_orphans()` | Removes CAS blob files whose filesystem hardlink count is `1`, meaning no study-facing hardlink exists. |

The orphan sweep is a filesystem failsafe. The DB reference count path is the more semantically precise cleanup during normal study deletion.

## 11. Storage Service

`StorageService` is the bridge between CAS filesystem operations and database `FileRecord` rows.

### `store_original(...)`

Used when an upload is finalized:

1. Commit uploaded chunks into CAS.
2. Generate a new file ID.
3. Link the CAS blob into the study file directory.
4. If the file has a non-null `viewer_purpose`, clear old active rows for the same study and purpose.
5. Insert a `FileRecord`.
6. Return the record.

### `store_derived(...)`

Used by pipeline artifacts:

1. Commit the artifact file into CAS.
2. Use the provided file ID or generate a new one.
3. Link the CAS blob into the study file directory.
4. Clear old active rows for the same viewer purpose when relevant.
5. Insert a `FileRecord`.
6. Return the record.

Both methods preserve old records but clear their active viewer purpose when they are superseded.

## 12. Upload Flow

Uploads are chunked and stateful.

### API flow

1. `POST /storage/studies/{study_id}/uploads:begin`
2. `PUT /storage/uploads/{upload_id}/chunk?index={index}` one or more times
3. `GET /storage/uploads/{upload_id}/status` optionally
4. `POST /storage/uploads/{upload_id}:finalize`
5. `DELETE /storage/uploads/{upload_id}` to abort before finalization

### Upload kind to viewer purpose

`UploadService` maps uploaded file kind to viewer purpose:

| Upload kind | Viewer purpose | Meaning |
|---|---|---|
| `nifti_raw` | `viewer_volume` | Active base NIfTI volume for visualization. |
| `nifti_mask` | `viewer_overlay` | Active segmentation/overlay mask. |
| `dicom_zip` | `NULL` | Source archive, not directly loaded by the viewer. A pipeline can derive a viewer volume from it. |

### Finalization behavior

`UploadService.finalize(...)` currently:

1. Loads the `UploadSession`.
2. Rejects finalization unless the session is `active`.
3. Stores the original upload through `StorageService.store_original(...)`.
4. For `nifti_raw` and `dicom_zip`, sets the study's `PipelineJob.source_file_id` to the uploaded file.
5. Dispatches pipeline steps if `JobPipelineService` is present and steps are needed.
6. If no job is dispatched, marks the pipeline job `ready`.
7. Marks the upload session `finalized`.
8. Removes temporary upload files.
9. Returns the new `file_id` and optional `job_id`.

Chunk writes are idempotent for same-size repeated chunks: if the requested chunk index already exists with the same byte size, the service returns the existing size rather than rewriting.

## 13. Study Lifecycle

`StudyService` owns study-level operations.

| Operation | Current behavior |
|---|---|
| Create | Inserts a `Study`, then creates the study's singleton `PipelineJob` with status `created`. |
| List | Returns studies, optionally filtered by exact name, with pipeline job loaded. |
| Rename | Updates the study name. |
| Delete | Cancels queued/running job if possible, deletes file records, removes study files from disk, deletes unreferenced CAS blobs, then deletes the study row. |

The frontend currently prevents duplicate study names by checking `listStudies(name)` before creating, but the database does not enforce name uniqueness.

## 14. Pipeline Architecture

Pipeline work is organized as async orchestration plus subprocess compute.

```text
Upload finalize
    |
    v
JobPipelineService.dispatch(...)
    |
    | builds step list
    | updates PipelineJob -> queued
    | creates StepContext
    v
asyncio.run_coroutine_threadsafe(run_pipeline(...), app_loop)
    |
    v
run_pipeline(...)
    |
    | sets job -> running
    | runs steps sequentially
    | collects OutputArtifact objects by purpose
    | stores derived artifacts through StorageService
    | sets job -> completed / failed / cancelled
    v
FileRecord rows + CAS blobs + WebSocket messages
```

### Threading model

FastAPI sync route handlers run in a worker thread, while `run_pipeline(...)` is async and must execute on the app event loop. `JobPipelineService` captures the event loop during FastAPI lifespan startup and uses `asyncio.run_coroutine_threadsafe(...)` to schedule pipeline work from sync service code.

The returned `concurrent.futures.Future` is stored in `_running` by `job_id`, which allows cancellation from service code.

### Step selection

`JobPipelineService.dispatch(...)` builds steps in two phases:

| Phase | Behavior |
|---|---|
| Auto steps | If the uploaded file is `dicom_zip`, prepend `DicomToNiftiStep`. |
| User-requested steps | For each item in the finalize `pipelines` payload, look up a factory in `step_registry`. Currently the public schema allows `segment_nifti`. |

If no steps are produced, dispatch returns `None` and the upload flow marks the job as `ready`.

### `StepContext`

`StepContext` carries:

| Field | Meaning |
|---|---|
| `job_id` | Current pipeline job ID. |
| `study_id` | Study being processed. |
| `current_input_path` | Current input file path for the next step. |
| `work_dir` | Temporary job workspace under `data/tmp/jobs/{job_id}`. |
| `broadcaster` | WebSocket broadcaster for job updates. |
| `_worker_pool` | Process pool wrapper used to run CPU/ML work out-of-process. |

`StepContext.run_subprocess(...)` delegates compute functions to `WorkerPool.run(...)`.

### Pipeline steps

| Step | File | Input | Output artifact |
|---|---|---|---|
| `DicomToNiftiStep` | `workers/steps/dicom_to_nifti.py` | DICOM ZIP or single `.dcm` path | `converted.nii.gz`, `kind="nifti_derived"`, `purpose="viewer_volume"` |
| `SegmentNiftiStep` | `workers/steps/segment_nifti.py` | NIfTI path | `segmentation_mask.nii.gz`, `kind="segmentation_mask"`, `purpose="viewer_overlay"` |

`run_pipeline(...)` stores only one artifact per purpose. If multiple steps emit the same purpose, the later artifact overwrites the earlier artifact in the in-memory collection before storage.

### Subprocess functions

| Function | File | Behavior |
|---|---|---|
| `convert_dicom(...)` | `workers/subprocesses/dicom_fn.py` | Extracts ZIP or copies a single DICOM file, then currently writes a placeholder/zero-array NIfTI through nibabel fallback behavior. |
| `_init_segmentation(...)` | `workers/subprocesses/segmentation_fn.py` | Loads the ONNX model once per worker process. |
| `run_segmentation(...)` | `workers/subprocesses/segmentation_fn.py` | Loads a NIfTI, pads input to a multiple of 16, runs ONNX inference, thresholds output at `0.5`, unpads, and saves a mask NIfTI. |

### Pipeline statuses

Internal pipeline statuses include:

| Status | Meaning |
|---|---|
| `created` | Study exists and has a job row, but no upload/pipeline has made it ready yet. |
| `queued` | Steps have been prepared and scheduled. |
| `running` | `run_pipeline(...)` is executing steps. |
| `ready` | No pipeline was needed, but the study has a usable uploaded file. |
| `completed` | Pipeline completed and derived artifacts were stored. |
| `failed` | Pipeline raised an exception; `PipelineJob.error` stores the message. |
| `cancelled` | Pipeline was cancelled. |

API study/file responses use `study_workflow_display_status(...)` to convert internal job statuses into frontend-friendly statuses:

| Internal status | Display status |
|---|---|
| `queued`, `running` | `processing` |
| `completed`, `ready` | `ready` |
| `created` | `created` |
| anything else | unchanged, such as `failed` or `cancelled` |

## 15. API Schemas

`backend/schemas.py` defines the API contract.

### Upload schemas

| Schema | Important fields |
|---|---|
| `BeginUploadRequest` | `kind: "dicom_zip" | "nifti_raw" | "nifti_mask"`, `filename`. |
| `BeginUploadResponse` | `upload_id`, `chunk_size`. |
| `ChunkUploadResponse` | `index`, `received`. |
| `UploadStatusResponse` | `upload_id`, `state`, `uploaded_chunks`. |
| `PipelineRequestItem` | `name: "segment_nifti"`, `config`. |
| `FinalizeRequest` | `expected_size`, `pipelines`. |
| `FinalizeResponse` | `file_id`, optional `job_id`. |

### Study schemas

| Schema | Important fields |
|---|---|
| `CreateStudyRequest` | Optional `name`. |
| `RenameStudyRequest` | Required `name`. |
| `StudyResponse` | `id`, `name`, `created_at`, display `status`. |

### File and pipeline schemas

| Schema | Important fields |
|---|---|
| `FileRecordResponse` | `id`, `study_id`, `kind`, `viewer_purpose`, `display_name`, `blob_hash`, `size`, `created_at`, display `status`. |
| `PipelineJobResponse` | `id`, `study_id`, `source_file_id`, `steps`, internal `status`, `created_at`, `error`. |

## 16. Routers and HTTP Surface

### Studies

Defined in `backend/routers/studies.py`, prefix `/storage/studies`.

| Method/path | Behavior |
|---|---|
| `GET /storage/studies?name={name}` | List studies, optionally by exact name. |
| `POST /storage/studies` | Create a study and its singleton pipeline job. |
| `PATCH /storage/studies/{study_id}` | Rename a study. |
| `DELETE /storage/studies/{study_id}` | Delete a study, associated records, study files, and unreferenced CAS blobs. |

### Uploads

Defined in `backend/routers/uploads.py`.

| Method/path | Behavior |
|---|---|
| `POST /storage/studies/{study_id}/uploads:begin` | Start an upload session. |
| `PUT /storage/uploads/{upload_id}/chunk?index={index}` | Upload one chunk. |
| `GET /storage/uploads/{upload_id}/status` | Return upload state and uploaded chunk indexes. |
| `POST /storage/uploads/{upload_id}:finalize` | Commit chunks to CAS, create a file record, and optionally dispatch a pipeline. |
| `DELETE /storage/uploads/{upload_id}` | Abort an upload and remove temporary chunks. |

### Files

Defined in `backend/routers/files.py`, prefix `/storage/studies`.

| Method/path | Behavior |
|---|---|
| `GET /storage/studies/{study_id}/files?viewer_purpose={csv}` | List file records for a study, optionally filtered by comma-separated viewer purposes. |
| `GET /storage/studies/{study_id}/files/{file_id}/content` | Stream the study-facing file path as `application/octet-stream`. |

The frontend uses `viewer_purpose=viewer_volume,viewer_overlay` to load only files that should be displayed by NiiVue.

### WebSocket

Defined in `backend/routers/ws.py`.

| Path | Behavior |
|---|---|
| `WS /ws/pipeline/{job_id}` | Registers the client with `WSBroadcaster` for messages related to a pipeline job. |

The current WebSocket endpoint keeps the connection open by waiting for incoming text frames. Pipeline steps broadcast JSON messages such as step completion, final completion, or failure.

## 17. Error Handling

Application errors inherit from `AppError` in `backend/exceptions.py`.

| Error | HTTP status |
|---|---|
| `NotFoundError` | `404` |
| `ConflictError` | `409` |
| `ValidationError` | `422` |
| generic `AppError` | `500` unless overridden |

`app.py` registers a FastAPI exception handler that returns `{"detail": ...}` for these errors.

## 18. Frontend Layout

```text
packages/application/frontend/
|-- index.html
|-- package.json
|-- package-lock.json
|-- tsconfig.json
|-- src/
|   |-- api/
|   |-- app/
|   |-- styles/
|   `-- vite-env.d.ts
`-- .vite/
```

The frontend is a Vite + React app. Its important dependencies include React, React Router, NiiVue, Tailwind CSS, Radix UI components, and related UI/helper packages.

### Frontend API layer

| File | Purpose |
|---|---|
| `src/api/client.ts` | Shared `fetchJson(...)` helper and `ApiError`. |
| `src/api/types.ts` | TypeScript interfaces matching backend response/request schemas. |
| `src/api/studies.ts` | Study CRUD, file listing, and file content URL helpers. |
| `src/api/upload.ts` | Chunked upload client that begins an upload, slices a browser `File`, uploads chunks, then finalizes. |
| `src/api/ws.ts` | Pipeline WebSocket client. |

### Frontend routes

Defined in `src/app/routes.tsx`.

| Route | Component | Purpose |
|---|---|---|
| `/` | `StartPage` | Entry page. Opens raw local files, creates studies, or navigates to browsing. |
| `/browse` | `StudyBrowsePage` | Lists saved studies, supports rename/delete, and opens a study on double click. |
| `/visualize/:studyId?` | `VisualizationPage` | NiiVue visualization page. Works in volatile local-file mode or persistent study mode. |

### Study creation flow in the UI

`StartPage` currently:

1. Opens the create-study modal.
2. Checks if a study with the same name already exists.
3. Creates the study.
4. Maps DICOM input to `dicom_zip` and NIfTI input to `nifti_raw`.
5. Adds `[{ name: "segment_nifti" }]` if automated segmentation is selected.
6. Uploads the base file through `uploadFile(...)`.
7. If precomputed segmentation is selected, uploads that file as `nifti_mask`.
8. Navigates to `/visualize/{study.id}`, passing `jobId` from the base upload result.

### Visualization flow

`VisualizationPage` has two modes:

| Mode | Behavior |
|---|---|
| Volatile mode | If no `studyId` exists, loads browser `File` objects directly into NiiVue via object URLs. No backend persistence. |
| Persistent study mode | Lists backend files for `viewer_volume,viewer_overlay`, builds content URLs, and loads them into NiiVue. |

If a `jobId` is passed through route state, the page connects to `/ws/pipeline/{job_id}`. On pipeline completion, it reloads study files so newly stored derived files become visible.

## 19. Tests

Tests live under `packages/application/tests`.

```text
packages/application/tests/
|-- conftest.py
|-- unit/
|   |-- backend/
|   |-- poc_file_storage/
|   `-- poc_ml_worker/
`-- integration/
    |-- backend/
    `-- poc_file_storage/
```

### Shared test setup

`tests/conftest.py` provides:

| Fixture | Purpose |
|---|---|
| `db_engine` | In-memory SQLite engine with foreign keys enabled and a shared static pool. |
| `db_session` | Test session with rollback/close after each test. |
| `session_factory` | Session factory bound to the in-memory engine. |
| `tmp_data_root` | Temporary data directory with `blobs/sha256`, `studies`, and `uploads`. |

### Backend unit tests

Backend unit tests cover:

| Test area | Examples |
|---|---|
| Models | Relationships, indexes, and constraints. |
| Repositories | Study, file, upload session, and pipeline job data behavior. |
| Local storage engine | Chunk writes, CAS commit, checksum/size validation, deduplication, hardlinks, job workspaces, and orphan sweeping. |
| Storage service | Original and derived file storage and viewer purpose superseding. |
| Upload service | Begin/write/finalize/abort behavior and pipeline dispatch decisions. |
| Job pipeline service | Step construction, dispatch, cancellation bookkeeping. |
| Pipeline runner | Status transitions, derived artifact storage, cancellation, failure handling. |
| Pipeline steps | Step result contracts and subprocess delegation. |
| WebSocket broadcaster | Registration, broadcast, cleanup of failed sockets. |

### Backend integration tests

Integration tests exercise HTTP/API-level flows:

| Test area | Behavior |
|---|---|
| Upload flow | Begin, chunk upload, status, finalize, abort. |
| Study lifecycle | Create, list, rename, delete. |
| Full pipeline behavior | NIfTI upload, precomputed mask upload, viewer purpose filtering, CAS deduplication, active-purpose superseding, and study delete cleanup. |

## 20. End-to-End Data Flows

### A. Create study with raw NIfTI and no pipeline

1. Frontend calls `POST /storage/studies`.
2. Backend creates `Study` and singleton `PipelineJob(status="created")`.
3. Frontend uploads the NIfTI as `nifti_raw`.
4. Finalization stores the original in CAS.
5. A `FileRecord` is created with `viewer_purpose="viewer_volume"`.
6. No steps are dispatched if `pipelines=[]`.
7. `PipelineJob.status` becomes `ready`.
8. Viewer lists `viewer_volume,viewer_overlay` and loads the volume.

### B. Create study with raw NIfTI and automated segmentation

1. Study is created.
2. Base file is uploaded as `nifti_raw`.
3. Finalization stores the raw NIfTI as active `viewer_volume`.
4. `PipelineJob.source_file_id` points to that raw file.
5. `JobPipelineService` dispatches `segment_nifti`.
6. `run_pipeline(...)` sets job status to `running`.
7. `SegmentNiftiStep` runs ONNX segmentation in the process pool.
8. The produced mask is committed to CAS via `store_derived(...)`.
9. A `FileRecord` is created with `kind="segmentation_mask"` and `viewer_purpose="viewer_overlay"`.
10. Job status becomes `completed`, which maps to display status `ready`.
11. Viewer reloads and displays both volume and overlay.

### C. Create study from DICOM ZIP

1. Study is created.
2. Base file is uploaded as `dicom_zip`.
3. Finalization stores the ZIP in CAS with no viewer purpose.
4. Dispatch prepends `DicomToNiftiStep`.
5. If automated segmentation is requested, `SegmentNiftiStep` runs after DICOM conversion.
6. DICOM conversion emits a derived NIfTI with `viewer_purpose="viewer_volume"`.
7. Segmentation emits a mask with `viewer_purpose="viewer_overlay"`.
8. Derived artifacts are committed to CAS and linked into the study.
9. Viewer loads the active volume and overlay records.

### D. Replace an active viewer file

1. A new file is uploaded or produced with the same non-null viewer purpose as an existing file.
2. `StorageService` calls `FileRepo.clear_viewer_purpose(...)`.
3. Old rows for that study/purpose are updated to `viewer_purpose=NULL`.
4. The new file record is inserted with the active purpose.
5. Viewer queries only return the new active file for that purpose.
6. Old file records and blobs may remain if still referenced, preserving history and CAS deduplication.

### E. Delete a study

1. If the study job is queued or running, `StudyService` asks `JobPipelineService` to cancel it.
2. File records for the study are deleted and their blob hashes collected.
3. The study directory under `data/studies/{study_id}` is removed.
4. Each collected blob hash is checked for remaining DB references.
5. Blobs with zero references are deleted from CAS.
6. The `Study` row is deleted, cascading the singleton `PipelineJob`.

## 21. Current Design Notes and Constraints

- The backend currently uses SQLite and local filesystem storage. There is a `StorageEngine` protocol, so another backend could be implemented later, but the app is currently wired to `LocalStorageEngine`.
- The active viewer file concept is based on `viewer_purpose`, not on file kind alone. This lets `nifti_raw` and DICOM-derived NIfTI both become `viewer_volume`, while raw DICOM archives stay non-viewer files.
- `PipelineJob` is a singleton per study, so the current model tracks the current or most recent pipeline state rather than a full job history.
- CAS blobs are immutable by content hash. `FileRecord` rows provide study ownership, display name, purpose, and API visibility.
- The frontend's duplicate study-name check is a UI-level guard only. The database allows duplicate names.
- Pipeline WebSocket messages are transient. Current durable state is stored on `PipelineJob`, not in a separate event log.
- DICOM conversion currently has placeholder/fallback behavior rather than a full production DICOM-to-NIfTI conversion stack.
- CAS orphan sweeping based on hardlink count works best when study files are hardlinks. If the engine had to copy because hardlinks failed, DB-reference cleanup during study deletion is the more reliable cleanup path.

## 22. Quick Run Reference

Backend from repository root:

```bash
uvicorn backend.main:app --reload --port 8000
```

Frontend:

```bash
cd packages/application/frontend
npm install
npm run dev
```

Tests from repository root after installing the Python project:

```bash
pytest
```

The frontend dev server proxies `/storage` and `/ws` to the backend on port `8000`.
