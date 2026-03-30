**RFC 1 \-  CBCT Image Analysis Application**

Architecture Overview & Implementation Reference

# **1\. Purpose and Scope**

This document describes the architecture of a desktop application for processing and visualizing Cone Beam Computed Tomography (CBCT) medical imaging data.

The application runs entirely on a single machine. There is no remote server. The frontend is an Electron-based desktop shell. The backend is a Python process running a FastAPI HTTP and WebSocket server, accessed locally by the frontend. All data — scans, derived files, database records — resides on the local filesystem.

The system is designed around three core problems:

* Medical imaging files (NIfTI, DICOM) are large. Uploading them naively into memory or across a loopback connection will cause failures. The architecture uses chunked upload sessions with resumability and integrity verification to handle this safely.

* Deep learning inference (segmentation) is CPU/GPU-intensive and must not block the web server. The architecture offloads this work to isolated subprocess workers.

* The same file content may be uploaded more than once (e.g., re-creating a study with the same scan). The architecture uses content-addressed storage to deduplicate blobs on disk.

# **2\. System Components**

## **2.1 Frontend (Electron)**

The frontend is an Electron application. It renders a web-based UI inside a desktop window and communicates with the local backend over HTTP and WebSocket. Its responsibilities are:

* Presenting the three user workflows: open raw file, create study, browse studies.

* Slicing files into chunks for upload using the browser File API.

* Managing upload session state (begin, chunk, finalize).

* Opening a WebSocket connection to receive real-time progress from background pipeline jobs.

* Rendering 3D medical images using the NiiVue viewer library.

The frontend does not perform any image processing. It does not load full files into memory. It does not write to the filesystem directly.

## **2.2 Backend (FastAPI)**

The backend is a Python process started alongside (or by) the Electron shell. It exposes:

* A REST API for study management, upload sessions, and file retrieval.

* A WebSocket endpoint for real-time pipeline progress updates.

* Background workers (subprocess pool) for DICOM conversion and segmentation.

The backend owns the database, the on-disk storage layout, and all business logic. The FastAPI event loop handles HTTP and WebSocket traffic. All heavy computing runs in a separate process pool so it cannot block the event loop.

## **2.3 Database (SQLite)**

A local SQLite database tracks four types of records:

| Record | Description |
| :---- | :---- |
| Study | A named case. Holds an **external\_id** (user-provided name), a **status** (pending / processing / ready), and **timestamps**. |
| FileRecord | A file associated with a study. Tracks **role** (original or derived), **kind** (nifti\_raw, dicom\_zip, segmentation\_mask, etc.), **purpose** for the viewer (viewer\_volume, viewer\_overlay, or null), the SHA-256 **hash** linking to the CAS blob, and NIfTI **header metadata**. |
| UploadSession | A transient record representing an in-progress chunked upload. Holds **expected size**, **expected hash**, negotiated **chunk size**, and **state** (active / finalized / aborted / expired). Cleaned up by a background scheduler after a TTL expires. |
| PipelineJob | A record of a background processing job. Holds **status** (queued / running / completed / failed / cancelled), an **audit log** of step names, and **error information** on failure. |

## **2.4 Storage Layout**

All files are stored under a single data root directory. The layout separates immutable blobs from study-specific links:

| Path | Contents |
| :---- | :---- |
| data/blobs/sha256/\<xx\>/\<hash\> | Immutable content-addressed blobs. The first two characters of the hash form a subdirectory to limit directory size. |
| data/studies/{study\_id}/raw/ | Hardlinks pointing to blobs for original uploaded files. |
| data/studies/{study\_id}/derived/ | Hardlinks pointing to blobs for pipeline-produced files. |
| data/uploads/{upload\_id}/parts/ | Temporary chunk files during an active upload session. Removed on finalization. |

## **2.5 Backend Module Layout**

The backend is organized into layers with strict dependency direction: routers call services, services call repositories and storage, workers are invoked by services and report back via the broadcaster.

| Module | Responsibility |
| :---- | :---- |
| routers/ | Thin HTTP and WebSocket handlers. One service call per endpoint. No logic. |
| services/ | Business logic: upload lifecycle, CAS commits, study CRUD, job dispatch. |
| workers/ | Pipeline runner, subprocess pool wrapper, step implementations, WebSocket broadcaster. |
| db/ | SQLAlchemy models, session factory, repository classes. |
| storage/ | Pure path computation, chunk I/O, CAS commit functions. |

# **3\. User Workflows**

The application exposes three distinct entry points to the user. Each maps to a different backend code path.  
![][image1]

## **3.1 Open Raw File (Volatile Workspace)**

This pathway allows rapid visualization without creating a database record. The user selects a primary NIfTI file (the main scan volume) and optionally a second NIfTI file to use as a segmentation overlay. Only NIfTI format is supported in this mode.

The application loads the file(s) directly into the NiiVue 3D viewer. Data stays in memory only. No upload session is started, no Study is created, and no pipeline can be triggered from this mode. If the user closes the view or the application, the data is gone.

This mode exists for quick inspection of files already on disk, without committing them to the study database.

![][image2]

## **3.2 Create a Study (Persistent Workspace)**

This pathway creates a permanent database record and processes files through the storage and (optionally) ML pipelines.

* The user provides a Study Name and uploads a base medical image. The system accepts either a NIfTI file or a DICOM directory. If a DICOM directory is provided, the frontend compresses it into a ZIP archive before uploading. If a study with a given name already exists, the frontend receives an exception which is mapped later to the appropriate message. As an addition, we may also consider an option where, on StudyName field lose of focus, the frontend calls `GET /storage/studies?external_id=<name>` in order to check whether the Study exists and inform the user early, although the aforementioned mechanism also has to be in place.

* The user chooses one of three secondary inputs: no mask (volume only), a pre-computed NIfTI segmentation mask, or automated segmentation via the deep-learning pipeline. Choosing automated segmentation disables the manual mask upload field.

* The frontend runs the chunked upload sequence (see Section 4.1).

* After finalization, the backend optionally dispatches a background pipeline job and returns a `job_id`. The frontend opens a WebSocket to receive progress updates.

* When the study reaches ready status, the frontend opens the NiiVue viewer with the volume and overlay files linked to the study.

![][image3]

## **3.3 Browse Studies**

This pathway provides a table listing all saved studies. From this view the user can:

* Open a study by double-clicking a row (loads the viewer with that study's files).

* Rename a study (calls `PATCH /storage/studies/{study_id}`).

* View file metadata for each study.

* Delete a study (calls `DELETE /storage/studies/{study_id}`, which cancels any active pipeline job before removing files).

![][image4]

# **4\. Data Flow**

## **4.1 Chunked Upload Protocol**

Medical imaging files can range from hundreds of megabytes to several gigabytes. The upload protocol handles this through a three-step state machine that avoids loading the full file into memory on either side.

### **Step 1: Begin**

The frontend calls `POST /storage/studies/{study_id}/uploads:begin`, providing the file kind (nifti\_raw, nifti\_mask, or dicom\_zip). The backend creates an UploadSession record, allocates a temporary parts directory, and returns an upload\_id and the negotiated chunk\_size. The role is automatically assigned by the backend.

### **Step 2: Chunk**

The frontend uses the browser File API's `slice()` method to read sequential byte ranges without loading the full file. Each slice is sent via  
`PUT /storage/uploads/{upload_id}/chunk?index={i}`. The operation is idempotent: if the backend finds a chunk file at that index with the expected size already present, it returns 200 OK immediately. This allows the frontend to safely retry individual chunks or resume an interrupted upload by re-sending all chunk indices — already-uploaded ones are skipped without re-writing.

### **Step 3: Finalize**

The frontend calls POST /storage/uploads/{upload\_id}:finalize, providing the expected file size, SHA-256 hash, and optionally a list of pipeline identifiers (e.g., segment\_nifti). The backend stitches all chunk files in order into a single file, computes its SHA-256 hash and total size, and checks both against the values declared in the payload. A mismatch raises a 422 error and the upload is rejected. On success, the backend commits the file to CAS (see Section 4.2) and dispatches any requested pipeline (see Section 4.3).

| Note | If the upload session expires (TTL cleanup) or is aborted, the parts directory is removed and the session record is marked aborted. The client must start a new session to retry. |
| :---- | :---- |

## **4.2 Content-Addressed Storage (CAS)**

After a successful finalize integrity check, the backend commits the assembled file to the CAS directory. This is done atomically using `os.replace()`, which is a rename on POSIX systems. The target path is derived entirely from the SHA-256 hash of the file content.

If the blob path already exists (i.e., an identical file was previously uploaded), the new file is discarded and the existing blob is reused. This deduplication is automatic and requires no special handling on the client side.

After the blob is committed, a **FileRecord** is created in the database. A study-specific hardlink is created from `data/studies/{study_id}/raw/<filename>` pointing to the blob. This means each study has its own directory entry for its files, but the underlying bytes are stored only once.

The **purpose** field on the **FileRecord** is set based on file kind at this point: nifti\_raw files get **viewer\_volume**, nifti\_mask files get **viewer\_overlay**, and dicom\_zip files get  **None** (the viewer\_volume purpose is assigned later by the DicomToNiftiStep). Only one FileRecord with a given purpose may be active per study at a time — setting a new viewer\_overlay atomically clears the previous one.

**4.3 Pipeline Dispatch**

If the finalize request includes pipeline identifiers, the backend constructs a list of pipeline steps and dispatches a background job. Step construction has two phases:

* Auto-steps are determined by the file kind, not by the user. A dicom\_zip upload always prepends a DicomToNiftiStep, regardless of what else was requested.

* User steps are derived from the pipeline identifiers in the finalize payload (e.g., segment\_nifti maps to SegmentNiftiStep). These are appended after auto-steps.

If the combined step list is empty, no **PipelineJob** is created and job\_id=null is returned. Otherwise, a **PipelineJob** record is created, a StepContext is assembled (holding references to the job ID, study ID, the source file's blob hash, the StorageService, and the broadcaster), and an asyncio task is created to run the pipeline.

## **4.4 Pipeline Execution**

A pipeline **step** represents a single, independent unit of work. Steps are completely isolated from global application state (like active database sessions or worker pools). Instead, everything a step needs is injected into it via the **StepContext** (`ctx`) object. This context provides the step with its current input file hash and the specific tools it is permitted to use (storage access, subprocess offloading, and WebSocket broadcasting).

By relying solely on the `ctx` object, steps simply act on whatever input they are handed. A step does not need to know where it sits in the pipeline — it blindly processes its input and returns an output.

## **4.5 Pipeline Sequence**

The pipeline runner executes steps sequentially. After each step completes, the output blob hash and file ID from that step's result become the input for the next step. This chaining allows, for example, a DICOM conversion step to feed its NIfTI output directly into a segmentation step.

Each step does the following:

* Resolves the input blob path from the current source hash.

* If heavy computation is needed, the step uses the context to offload a pure Python function to the process pool executor. Only plain strings cross the process boundary — no ORM objects, no service instances, no ML models. After the subprocess is done, it receives the output path from the subprocess function.

* Calls store\_derived procedure to commit the output file to CAS and create a **FileRecord** with role=derived.

* Broadcasts a progress update via the WebSocket broadcaster.

* Returns a **StepResult** holding the new blob hash and file ID.

Given the example of ONNX segmentation implemented in the POC, the model is loaded once per worker process at pool startup via a process pool initializer. It is not reloaded for each inference call, and it is never serialized across the process boundary.

On failure, the job is marked failed and the error message is broadcast. On cancellation (e.g., triggered by study deletion), the asyncio task is cancelled and the job is marked cancelled.

## **4.6 File Retrieval for Visualization**

After a study reaches ready status, the frontend requests file records from   
`GET /storage/studies/{study_id}/files?purpose=viewer_volume,viewer_overlay`. It then passes the content URLs to NiiVue.

NiiVue fetches image data via   
`GET /storage/studies/{study_id}/files/{file_id}/content`. The backend serves this using FastAPI's **FileResponse**, which natively supports HTTP Range Requests (206 Partial Content). NiiVue uses range requests to fetch only NIfTI headers or specific volume slices as needed, rather than downloading the full file before rendering. Decompression of .nii.gz files is handled client-side by NiiVue.

# **5\. Real-Time Progress (WebSocket)**

When a pipeline job is dispatched, the finalize response includes a **job\_id**. The frontend immediately opens a WebSocket connection to `/ws/pipeline/{job_id}`.

The backend maintains a **WSBroadcaster** registry, which is a dictionary mapping job IDs to lists of connected WebSocket clients. When the pipeline runner (or a step) calls `broadcaster.broadcast(job_id, payload)`, the payload is sent to all registered sockets for that job.

Broadcast payloads contain a status field and optional progress, step, and error fields. The client uses these to update a progress display.

On pipeline completion, the broadcast payload includes the new file IDs for any derived files (e.g., the segmentation mask). The frontend uses these IDs to load the viewer without needing to re-query the file list endpoint.

When the client disconnects, the WebSocket handler unregisters the socket from the broadcaster. The pipeline continues running regardless — disconnection does not cancel the job.

# **6\. Key Design Guarantees**

| Guarantee | Mechanism |
| :---- | :---- |
| Resumable uploads | Chunk writes are idempotent. The client can call the status endpoint on reconnect to see which indices are confirmed, then re-send remaining chunks. |
| Upload integrity | SHA-256 and byte size are declared at begin and verified at finalize. Any mismatch raises 422 before any FileRecord is created. |
| File deduplication | CAS commit skips the blob move if the hash path already exists. Re-uploading an identical file costs only the upload bandwidth, not additional disk space. |
| Memory safety | ONNX inference and DICOM conversion run in a ProcessPoolExecutor. A crash or memory error in a worker cannot affect the FastAPI event loop. |
| Non-blocking I/O | All subprocess calls are awaited via loop.run\_in\_executor(). The FastAPI event loop is never blocked by compute work. |
| Viewer uniqueness | Only one FileRecord with a specific purpose (viewer\_volume or viewer\_overlay) may be active per study. StorageService atomically nulls any prior record with the identical purpose in the same transaction as inserting the new one. |
| Clean study deletion | StudyService.delete() cancels any active PipelineJob before removing database records and filesystem hardlinks. |
| Worker pool extensibility | WorkerPool is a generic ProcessPoolExecutor wrapper. A second pool with a different initializer (e.g., a GPU pipeline) can be created in app.py and injected into specific step classes without touching JobPipelineService. |

# **7\. Example Flows**

## **Flow A: Upload a NIfTI scan with automated segmentation**

| \# | Actor | Action | Backend |
| :---- | :---- | :---- | :---- |
| 1 | User | Enters study name 'Patient-001' | —`GET /storage/studies?external_id=Patient-001 → 200, no match` |
| 2 | User | Selects a .nii.gz scan file, chooses automated segmentation | — |
| 3 | Frontend | Begins upload session | `POST /uploads:begin → {upload_id, chunk_size}` |
| 4 | Frontend | Sends N chunks | `PUT /uploads/{id}/chunk?index=0..N → 200 each` |
| 5 | Frontend | Finalizes with pipelines=\[{name: segment\_nifti}\] | `POST /uploads/{id}:finalize → {file_id, job_id}` |
| 6 | Backend | Commits scan to CAS, creates FileRecord (viewer\_volume), creates PipelineJob, starts asyncio task | `—` |
| 7 | Frontend | Opens WebSocket | `WS /ws/pipeline/{job_id} → connected` |
| 8 | Backend (worker) | Runs SegmentNiftiStep in subprocess | `Broadcasts {status: running, step: segment_nifti, progress: 45}` |
| 9 | Backend (worker) | Step completes, stores mask as FileRecord (viewer\_overlay) | `Broadcasts {status: completed, overlay_file_id: <id>}` |
| 10 | Frontend | Receives completed event, opens NiiVue viewer with volume \+ overlay | — |

## **Flow B: Upload a DICOM directory with automated segmentation**

| \# | Actor | Action | Backend |
| :---- | :---- | :---- | :---- |
| 1 | User | Selects a DICOM directory | `—` |
| 2 | Frontend | Compresses DICOM slices into a .zip archive client-side | `—` |
| 3 | Frontend | Begins upload session with kind=dicom\_zip | `POST /uploads:begin → {upload_id, chunk_size}` |
| 4 | Frontend | Sends chunks, finalizes with pipelines=\[{name: segment\_nifti}\] | `POST /uploads/{id}:finalize → {file_id, job_id}` |
| 5 | Backend | Detects kind=dicom\_zip, prepends DicomToNiftiStep automatically. Steps: \[dicom\_to\_nifti, segment\_nifti\] | — |
| 6 | Backend (worker) | DicomToNiftiStep: extracts ZIP, converts to NIfTI, stores as FileRecord (viewer\_volume) | Broadcasts step progress |
| 7 | Backend (worker) | SegmentNiftiStep: runs inference on converted NIfTI, stores mask as FileRecord (viewer\_overlay) | Broadcasts step progress |
| 8 | Frontend | Receives completed event, opens viewer | — |

## **Flow C: Resume an interrupted upload**

| \# | Actor | Action | Backend |
| :---- | :---- | :---- | :---- |
| 1 | Frontend | Upload interrupted after 12 of 20 chunks | — |
| 2 | Frontend (reconnect) | Calls status endpoint | `GET /uploads/{id}/status → {uploaded_indices: [0..11], state: active}` |
| 3 | Frontend | Re-sends chunks 12–19 only | `PUT /uploads/{id}/chunk?index=12..19 → 200 each` |
| 4 | Frontend | Finalizes normally | `POST /uploads/{id}:finalize → {file_id, job_id}` |

## **Flow D: Open a raw file (no persistence)**

| \# | Actor | Action | Backend |
| :---- | :---- | :---- | :---- |
| 1 | User | Selects 'Open Raw File' from the main menu | — |
| 2 | User | Picks a .nii.gz scan and optionally a mask .nii.gz | — |
| 3 | Frontend | Passes file references directly to NiiVue | No backend calls |
| 4 | Frontend | NiiVue loads and renders the volume in-memory | — |
| 5 | User | Closes the viewer | Files are released from memory; nothing persisted |

## **Flow E: Delete a study with an active pipeline**

| \# | Actor | Action | Backend |
| :---- | :---- | :---- | :---- |
| 1 | User | Clicks delete on a study currently processing | — |
| 2 | Frontend | Calls DELETE /storage/studies/{study\_id} | — |
| 3 | Backend | Finds active PipelineJob for study, cancels asyncio task | PipelineJob.status → cancelled |
| 4 | Backend | Nulls FileRecord entries, removes hardlinks from data/studies/{id}/ | — |
| 5 | Backend | Returns 204 | Study record removed from DB |

# **8\. API Reference Summary**

## **REST Endpoints**

| Method | Path | Description |
| :---- | :---- | :---- |
| GET | /storage/studies | List all studies. Supports ?external\_id= filter. |
| POST | /storage/studies | Create a new study. |
| PATCH | /storage/studies/{study\_id} | Rename a study. |
| DELETE | /storage/studies/{study\_id} | Delete a study (cancels active jobs first). |
| POST | /storage/studies/{study\_id}/uploads:begin | Start a chunked upload session. |
| PUT | /storage/uploads/{upload\_id}/chunk | Upload a single chunk (idempotent). Query param: index. |
| GET | /storage/uploads/{upload\_id}/status | Get upload session state and uploaded chunk indices. |
| POST | /storage/uploads/{upload\_id}:finalize | Finalize upload, commit to CAS, dispatch pipeline. |
| GET | /storage/studies/{study\_id}/files | List FileRecords. Supports ?purpose= filter. |
| GET | /storage/studies/{study\_id}/files/{file\_id}/content | Serve file bytes. Supports HTTP Range Requests. |

## **WebSocket Endpoint**

| Path | Description |
| :---- | :---- |
| WS /ws/pipeline/{job\_id} | Real-time pipeline progress. Broadcasts JSON payloads with status, progress, step, error, and on completion the derived file IDs. |

## **Pipeline Identifiers**

| Identifier | Triggered by | Step |
| :---- | :---- | :---- |
| dicom\_to\_nifti | Automatically when kind=dicom\_zip | DicomToNiftiStep — extracts and converts DICOM ZIP to NIfTI. |
| segment\_nifti | User request via finalize payload | SegmentNiftiStep — runs ONNX inference, produces segmentation mask. |

## **FileRecord Kinds and Purposes**

| Kind | Role | Purpose | Source |
| :---- | :---- | :---- | :---- |
| nifti\_raw | original | viewer\_volume | User-uploaded NIfTI scan. |
| nifti\_mask | original | viewer\_overlay | User-uploaded pre-computed segmentation mask. |
| dicom\_zip | original | null | User-uploaded DICOM directory (zipped by frontend). |
| nifti\_derived | derived | viewer\_volume | NIfTI produced by DicomToNiftiStep. |
| segmentation\_mask | derived | viewer\_overlay | Mask produced by SegmentNiftiStep. |

# 

# **9\. Proposed folder structure**

`backend/`  
`├── main.py                    # uvicorn entrypoint`  
`├── app.py                     # FastAPI factory + lifespan`  
`├── config.py                  # All settings (paths, chunk size, TTL, model path)`  
`├── schemas.py                 # Pydantic request/response models`  
`├── exceptions.py              # Custom HTTP exceptions`  
`│`  
`├── routers/`  
`│   ├── studies.py             # Study CRUD`  
`│   ├── uploads.py             # Chunked upload endpoints`  
`│   ├── files.py               # File content retrieval`  
`│   └── ws.py                  # WebSocket progress`  
`│`  
`├── services/`  
`│   ├── upload_service.py        # Upload state machine`  
`│   ├── storage_service.py       # CAS commit + FileRecord creation`  
`│   ├── study_service.py         # Study CRUD logic`  
`│   └── job_pipeline_service.py  # JobPipelineService: step routing, job creation, dispatch`  
`│`  
`├── workers/`  
`│   ├── steps/`  
`│   │   ├── base.py             # PipelineStep protocol, StepContext, StepResult`  
`│   │   ├── dicom_to_nifti.py   # DicomToNiftiStep`  
`│   │   └── segment_nifti.py    # SegmentNiftiStep`  
`│   ├── subprocesses/           # Subfolder for pure compute kernels`  
`│   │   ├── dicom_fn.py         # Subprocess fn: convert_dicom(path) → path`  
`│   │   └── segmentation_fn.py  # Subprocess fn: run_segmentation(path) → path`  
`│   ├── pipeline_runner.py      # run_pipeline() async orchestrator`  
`│   ├── worker_pool.py          # WorkerPool: ProcessPoolExecutor wrapper (generic)`  
`│   └── ws_broadcaster.py       # WebSocket registry + broadcast`  
`│`  
`├── db/`  
`│   ├── models.py              # SQLAlchemy ORM (4 models)`  
`│   ├── session.py             # Engine + session factory`  
`│   └── repos/`  
`│       ├── upload_session_repo.py`  
`│       ├── file_repo.py`  
`│       └── pipeline_job_repo.py`  
`│`  
`└── storage/`  
    `├── cas.py                 # CAS commit logic (commit_to_cas, commit_file_to_cas)`  
    `├── upload_session.py      # Chunk I/O`  
    `└── paths.py               # Pure path computation`

# **10\. Database Schemas**

## **Study**

Tracks a logical case or patient study.

| Column | Type | Notes |
| :---- | :---- | :---- |
| id | UUID (str) | Primary Key |
| external\_id | str? | Optional external reference, UNIQUE |
| status | str | created, processing, ready |
| created\_at | datetime | Timestamp |
| meta | JSON | Study-level metadata |

**FileRecord**

A study‑scoped file handle with path mapping and viewer metadata.

| Column | Type | Notes |
| :---- | :---- | :---- |
| id | UUID (str) | Primary Key |
| study\_id | UUID (str) | Foreign Key → Study |
| pipeline\_job\_id | UUID? | Foreign Key → PipelineJob (null for raw uploads) |
| role | str | Provenance: original / derived |
| kind | str? | dicom\_zip / nifti\_raw / nifti\_mask / nifti\_derived / segmentation\_mask |
| purpose | str? | UI Intent: null / viewer\_volume / viewer\_overlay *(only 1 active overlay/volume per study)* |
| rel\_path | str | Path relative to data root (data/studies/{id}/...) |
| blob\_hash | str(64) | Foreign Key → Blob.hash, serves as true CAS pointer |
| content\_type | str? | MIME type |
| size | int | Stored Size (Bytes) |
| created\_at | datetime | Timestamp |
| meta | JSON | NIfTI header info (shape, pixdim, affine, zooms, etc.)or DICOM info |

## **UploadSession**

Tracks the resumable chunked upload state machine.

| Column | Type | Notes |
| :---- | :---- | :---- |
| id | UUID (str) | Primary Key |
| study\_id | UUID (str) | Foreign Key → Study |
| role | str | Assigned target role |
| kind | str | Assigned target kind |
| filename | str | Original uploaded filename |
| content\_type | str? | MIME type |
| expected\_size | int? | Total bytes declared by client |
| expected\_sha256 | str? | Hash declared by client for finalize verification |
| chunk\_size | int | Negotiated chunk size |
| state | str | active / finalized / aborted / expired |
| created\_at | datetime | Used for TTL tracking/expiration (e.g. 24h) |

## **PipelineJob**

Replaces the old POC Task model. Defines a background processing execution.

| Column | Type | Notes |
| :---- | :---- | :---- |
| id | UUID (str) | Primary Key, returned to client as job\_id |
| study\_id | UUID (str) | Foreign Key → Study |
| source\_file\_id | UUID (str) | Foreign Key → FileRecord that triggered the job |
| steps | JSON | Audit log array of step names (e.g., \["DicomToNiftiStep", "SegmentNiftiStep"\]) |
| status | str | queued / running / completed / failed / cancelled |
| created\_at | datetime | Timestamp |
| started\_at | datetime? | Execution start |
| finished\_at | datetime? | Execution finish |
| error | str? | Populated on pipeline failure |

## **Blob**

One row per uniquely hashed file content (CAS deduplication).

| Column | Type | Notes |
| :---- | :---- | :---- |
| hash | str(64) | Primary Key (SHA-256) |
| size | int | File size in bytes |
| created\_at | datetime | Timestamp |

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,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>

[image3]: <data:image/png;base64,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>

[image4]: <data:image/png;base64,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wB3m/se7BeZ+LfW9GQEQHUEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMABBBkAAAcQZAAAHECQAQBwAEEGAMAB/w8hOtgp4A+f8QAAAABJRU5ErkJggg==>