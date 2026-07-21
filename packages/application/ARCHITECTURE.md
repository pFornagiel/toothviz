

CBCT Image Analysis Application — Architecture Overview

RFC 1 -  CBCT Image Analysis
## Application

## Architecture Overview & Implementation Reference

- Purpose and Scope
This document describes the architecture of a desktop application for processing and visualizing
Cone Beam Computed Tomography (CBCT) medical imaging data.
The application runs entirely on a single machine. There is no remote server. The frontend is an
Electron-based desktop shell. The backend is a Python process running a FastAPI HTTP and
WebSocket server, accessed locally by the frontend. All data — scans, derived files, database
records — resides on the local filesystem.
The system is designed around four core problems:
- Medical imaging files (NIfTI, DICOM) are large. Uploading them naively into memory or
across a loopback connection will cause failures. The architecture uses chunked upload
sessions with resumability and integrity verification to handle this safely.
- Deep learning inference (segmentation) is CPU/GPU-intensive and must not block the
web server. The architecture offloads this work to isolated subprocess workers.
- The same file content may be uploaded more than once (e.g., re-creating a study with
the same scan). The architecture uses content-addressed storage to deduplicate blobs
on disk.
- The system should be filesystem-agnostic - the filesystem interactions are mediated
through a `StorageEngine` protocol for the sake of abstraction. No service class or step
constructs a raw path string — all path logic lives inside `LocalStorageEngine`. This
design ensures that a future migration to cloud storage (e.g., S3) requires no changes to
business logic.

## 2. System Components
2.1 Frontend (Electron)
The frontend is an Electron application. It renders a web-based UI inside a desktop window and
communicates with the local backend over HTTP and WebSocket. Its responsibilities are:
- Presenting the three user workflows: open raw file, create study, browse studies.
- Slicing files into chunks for upload using the browser File API’s slice method.
Internal — Implementation ReferencePage 1

CBCT Image Analysis Application — Architecture Overview

- Managing upload session state (begin, chunk, finalize).
- Opening a WebSocket connection to receive real-time progress from background
pipeline jobs.
- Rendering 3D medical images using the NiiVue viewer library.

The frontend does not perform any image processing. It does not load full files into memory. It
does not write to the filesystem directly.
2.2 Backend (FastAPI)
The backend is a Python process started alongside (or by) the Electron shell. It exposes:
- A REST API for study management, upload sessions, and file retrieval.
- A WebSocket endpoint for real-time pipeline progress updates.
- Background workers (a ProcessPoolExecutor pool) for DICOM conversion and
segmentation.

The backend owns the database, the on-disk storage layout, and all business logic. The
FastAPI event loop handles HTTP and WebSocket traffic. All heavy computing runs in a
separate process pool so it cannot block the event loop.

The backend is organized into layers with a strict, one-directional dependency flow:

## Record

## Description

routers/
Thin HTTP and WebSocket handlers. One service
call per endpoint. No business logic
services/
Business logic: upload lifecycle, CAS commits,
study CRUD, job dispatch.
workers/
Pipeline runner, subprocess pool wrapper, step
implementations, WebSocket broadcaster.
db/
SQLAlchemy models, session factory, repository
classes
storage/
StorageEngine protocol and
LocalStorageEngine implementation. All path
computation and physical I/O lives here

2.3 Database (SQLite)
A local SQLite database  (operating in WAL mode for concurrency) tracks five types of records:

## Record

## Description

## Study
A named case. Holds a name (display name), an
external_id (unique, provided by user), a status
Internal — Implementation ReferencePage 2

CBCT Image Analysis Application — Architecture Overview

## Record

## Description

(created / processing / ready), timestamps and
meta JSON for study-level metadata
FileRecord
A file associated with a study. Tracks role
(original or derived), kind (nifti_raw, dicom_zip,
segmentation_mask, etc., section 4.2), purpose
for the viewer (viewer_volume, viewer_overlay, or
null), original_filename, the SHA-256
blob_hash linking to the CAS blob, and NIfTI
header metadata.
UploadSession
A transient record representing an in-progress
chunked upload. Holds expected size,
expected_sha256, negotiated chunk size, and
state (active / finalized / aborted / expired) and
updated_at timetsamp. Cleaned up by a
background scheduler after a TTL expires.
PipelineJob
A record of a background processing job. Holds
status (queued / running / completed / failed /
cancelled), an audit log of step names, and error
information on failure, timestamps for start and
finish.
## 2.4 Storage Layout
All files are stored under a single data root directory. The layout separates immutable blobs from
study-specific links and temporary upload parts from committed content:

## Path

## Contents

data/blobs/sha256/<xx>/<hash>
Immutable content-addressed blobs. The first two
characters of the hash form a subdirectory to limit
directory size.
data/studies/{study_id}/raw/
Hardlinks pointing to blobs for original uploaded
files.
data/studies/{study_id}/derived/
Hardlinks pointing to blobs for pipeline-produced
files.
data/uploads/{upload_id}/parts/
Temporary chunk files during an active upload
session. Removed on finalization.
data/tmp/jobs/{job_id}/
Ephemeral workspace for a pipeline job's
intermediate outputs. Deleted by the pipeline
runner when the job completes or fails

Hardlinks are used instead of symlinks because they survive blob relocation, expose the correct
file size via stat(), and provide inode-level deduplication.
## 3. User Workflows
Internal — Implementation ReferencePage 3

CBCT Image Analysis Application — Architecture Overview

The application exposes three distinct entry points to the user. Each maps to a different backend
code path.

3.1 Open Raw File (Volatile Workspace)
This pathway allows rapid visualization without creating a database record. The user selects a
primary NIfTI file (the main scan volume) and optionally a second NIfTI file to use as a
segmentation overlay. Only NIfTI format is supported in this mode.
The application loads the file(s) directly into the NiiVue 3D viewer. Data stays in memory only.
No upload session is started, no Study is created, and no pipeline can be triggered from this
mode. If the user closes the view or the application, the data is gone.
This mode exists for quick inspection of files already on disk, without committing them to the
study database.



3.2 Create a Study (Persistent Workspace)
This pathway creates a permanent database record and processes files through the storage
and (optionally) ML pipelines.
● The user provides a Study Name and uploads a base medical image. The system
accepts either a NIfTI file or a DICOM directory. If a DICOM directory is provided, the
frontend compresses it into a ZIP archive before uploading. If a study with a given name
already exists, the frontend receives an exception which is mapped later to the
appropriate message. As an addition, we may also consider an option where, on
Internal — Implementation ReferencePage 4

CBCT Image Analysis Application — Architecture Overview

StudyName field lose of focus, the frontend calls GET
/storage/studies?external_id=<name> in order to check whether the Study
exists and inform the user early, although the aforementioned mechanism also has to be
in place.
● The user chooses one of three secondary inputs: no mask (volume only), a
pre-computed NIfTI segmentation mask, or automated segmentation via the
deep-learning pipeline. Choosing automated segmentation disables the manual mask
upload field.
● The frontend runs the chunked upload sequence (see Section 4.1).
● After finalization, the backend optionally dispatches a background pipeline job and
returns a job_id. The frontend opens a WebSocket to receive real-time progress
updates.
● When the study reaches ready status, the frontend opens the NiiVue viewer with the
volume and overlay files linked to the study.



## 3.3 Browse Studies
This pathway provides a table listing all saved studies. From this view the user can:
- Open a study by double-clicking a row (loads the viewer with that study's files).
- Rename a study (calls PATCH /storage/studies/{study_id}).
- View file metadata for each study.
- Delete a study (calls DELETE /storage/studies/{study_id}, which cancels any
active pipeline job before removing database records and filesystem hardlinks, and
immediately reclaims CAS blobs no longer referenced by any other study).

Internal — Implementation ReferencePage 5

CBCT Image Analysis Application — Architecture Overview


Internal — Implementation ReferencePage 6

CBCT Image Analysis Application — Architecture Overview


## 4. Data Flow
## 4.1 Chunked Upload Protocol
Medical imaging files can range from hundreds of megabytes to several gigabytes. The upload
protocol handles this through a three-step state machine that avoids loading the full file into
memory on either side.
## Step 1: Begin
The frontend calls POST /storage/studies/{study_id}/uploads:begin, providing the file
kind (nifti_raw, nifti_mask, or dicom_zip). The backend validates that the study exists, creates
an UploadSession record, allocates a temporary parts directory, and returns an upload_id and
the negotiated chunk_size. The role is automatically assigned by the backend.
## Step 2: Chunk
The frontend uses the browser File API's slice() method to read sequential byte ranges
without loading the full file. Each slice is sent via
PUT /storage/uploads/{upload_id}/chunk?index={i}. The operation is idempotent:
if the backend finds a chunk file at that index with the expected size already present, it returns
200 OK immediately. This allows the frontend to safely retry individual chunks or resume an
interrupted upload by re-sending all chunk indices — already-uploaded ones are skipped
transparently. The client can call GET /storage/uploads/{upload_id}/status at any
time to learn which chunk indices are confirmed and what the current session state is.
## Step 3: Finalize
The frontend calls POST /storage/uploads/{upload_id}:finalize, providing the expected
file size, SHA-256 hash, and optionally a list of pipeline identifiers (e.g., [{"name":
## "segment_nifti"}]).
The backend stitches all chunk files in order into a single file, computes its SHA-256 hash and
total size, and checks both against the values declared in the payload. A mismatch raises a 422
error and the upload is rejected - no FileRecord is created. On success, the backend commits
the file to CAS (Section 4.2), dispatches any requested pipeline (Section 4.3), marks the
session `finalized`, removes the parts directory, and transitions the study status to `processing`
(if a job was dispatched) or `ready` (if no pipeline is needed).

## Note

If the upload session expires (via TTL cleanup on startup) or is explicitly aborted by the client
(`DELETE /storage/uploads/{upload_id}`), the parts directory is removed and the session
record is marked `aborted` or `expired`. The client must begin a new session to retry.


4.2 Content-Addressed Storage (CAS)
After a successful finalize integrity check, the backend commits the assembled file to the CAS
directory. This is done atomically using os.replace(), which is a rename on POSIX systems.
The target path is derived entirely from the SHA-256 hash of the file content:
data/blobs/sha256/<first-2-chars>/<full-hash>.
Internal — Implementation ReferencePage 7

CBCT Image Analysis Application — Architecture Overview

If the blob path already exists (i.e., an identical file was previously uploaded), the new file is
discarded and the existing blob is reused. This deduplication is automatic and requires no
special handling on the client side.

After the blob is committed, a FileRecord is created in the database. A study-specific hardlink is
created from data/studies/{study_id}/raw/<filename> (for originals) or
derived/<filename> (for pipeline results) pointing to the blob. This means each study has
its own directory entry for its files, but the underlying bytes are stored only once.
The purpose field on the FileRecord is set based on file kind at this point: nifti_raw files get
viewer_volume, nifti_mask files get viewer_overlay, and dicom_zip files get  None (the
viewer_volume purpose is assigned later by the DicomToNiftiStep). Only one FileRecord with a
given purpose may be active per study at a time — setting a new viewer_overlay atomically
clears the previous one.

Kind enum
## Value Role Description
dicom_zip

original

DICOM series ZIP uploaded by
user

nifti_raw

original

Base-scan NIfTI uploaded
directly by user

nifti_mask

original

Pre-computed segmentation
mask NIfTI uploaded by user

nifti_derived

derived

NIfTI produced by
DicomToNiftiStep

segmentation_mask

derived

Binary/label NIfTI produced by
SegmentNiftiStep


Purpose enum
Value Who sets it Viewer usage
null

## Default

Not sent to viewer (e.g. the
original DICOM zip)

viewer_volume

UploadService.finalize() for
nifti_raw; DicomToNiftiStep for
DICOM-derived NIfTI

Primary 3D volume to render

viewer_overlay

UploadService.finalize() for
nifti_mask; SegmentNiftiStep
for auto-generated mask

Segmentation mask overlay



## Note

At most one FileRecord per purpose may be active per study at a time. The supersede rule
enforces this with last-write-wins semantics, preventing viewer conflicts if a user uploads a
mask and later runs automated segmentation on the same study

Internal — Implementation ReferencePage 8

CBCT Image Analysis Application — Architecture Overview



## 4.3 Pipeline Dispatch

If the finalize request includes pipeline identifiers, the JobPipelineService constructs a list of
pipeline steps and dispatches a background job. Step construction has two independent
phases:
- Auto steps are determined by the file kind, not by the user. A dicom_zip upload always
prepends a DicomToNiftiStep, regardless of what else was requested.
- User steps are derived from the pipeline identifiers in the finalize payload (e.g.,
segment_nifti maps to SegmentNiftiStep). These are appended after auto-steps.

If the combined step list is empty, no PipelineJob is created and job_id=null is returned.
Otherwise, a PipelineJob record is created, a StepContext is assembled and an asyncio task
is created to run the pipeline.
## 4.4 Pipeline Step Definition
A pipeline step represents a single, independent unit of work. Steps are completely isolated
from global application state (like active database sessions or worker pools). Instead, everything
a step needs is injected into it via the StepContext (ctx) object:
● job_id and study_id for identification.
● current_input_path — a Path pointing to the CAS blob or the previous step's temporary
output.t
● work_dir — an ephemeral directory under data/tmp/jobs/{job_id}/ for
intermediate outputs (and artifacts, more below).
● broadcaster — for emitting WebSocket progress events.
● _worker_pool — for offloading compute to the subprocess pool via await
ctx.run_subprocess(fn, *args).
This context provides the step with its current input file hash and the specific tools it is
permitted to use (storage access, subprocess offloading, and WebSocket broadcasting).
Steps do not call StorageService or write to the database — they emit OutputArtifact objects
that the pipeline runner persists at the end.
By relying solely on the ctx object, steps simply act on whatever input they are handed. A step
does not need to know where it sits in the pipeline — it blindly processes its input and returns an
output and a list of OutputArtifacts.

## Note

Subprocess functions receive and return plain path strings only. No ORM objects, service
instances, or ML models ever cross the process boundary. This guarantees picklability and
prevents accidental state leakage between processes.

## 4.5 Pipeline Execution
The pipeline runner executes steps sequentially in asyncio event loop. After each step
completes, the next_input_path path and list of OutputArtifacts from that step's result become
Internal — Implementation ReferencePage 9

CBCT Image Analysis Application — Architecture Overview

the input for the next step. This chaining allows, for example, a DICOM conversion step to feed
its NIfTI output directly into a segmentation step.
Each step does the following:
● Creates the work_dir at data/tmp/jobs/{job_id}/.
● Marks the PipelineJob status as running.
● Iterates over each step. After each step completes, ctx.current_input_path is updated to
result.next_input_path, chaining step outputs as inputs. OutputArtifacts are collected in a
dictionary keyed by purpose, enforcing last-write-wins if two steps emit the same
purpose.
● If heavy computation is needed, the step uses the context to offload a pure Python
function to the process pool executor. Only plain strings cross the process boundary —
no ORM objects, no service instances, no ML models. After the subprocess is done, it
receives the output path from the subprocess function.
● On success: calls storage_service.store_derived() once per collected artifact, sets
Study.status = ready, broadcasts completion, marks the job completed, and deletes the
workspace directory
● On failure: marks the job failed or cancelled, broadcasts the error

Given the example of ONNX segmentation implemented in the POC, the model is loaded once
per worker process at pool startup via a process pool initializer function. It is not reloaded for
each inference call and is never serialized across the process boundary.
On failure, the job is marked failed and the error message is broadcast. On cancellation (e.g.,
triggered by study deletion), the runner marks the job cancelled and cleans up.
4.6 File Retrieval for Visualization
After a study reaches ready status, the frontend requests file records from
## GET
## /storage/studies/{study_id}/files?purpose=viewer_volume,viewer_overlay.
It then passes the content URLs to NiiVue.
NiiVue fetches image data via
GET /storage/studies/{study_id}/files/{file_id}/content. The backend serves
this using FastAPI's FileResponse, which natively supports HTTP Range Requests (206 Partial
Content). NiiVue uses range requests to fetch only NIfTI headers or specific volume slices as
needed, rather than downloading the full file before rendering. Decompression of .nii.gz files is
handled client-side by NiiVue.
- Real-Time Progress (WebSocket)
When a pipeline job is dispatched, the finalize response includes a job_id. The frontend
immediately opens a WebSocket connection to /ws/pipeline/{job_id}.
The backend maintains a WSBroadcaster registry, which is a dictionary mapping job IDs to lists
of connected WebSocket clients. When the pipeline runner (or a step) calls
broadcaster.broadcast(job_id, payload), the payload is sent to all registered sockets
for that job. The broadcaster is called directly from the async pipeline runner.
Internal — Implementation ReferencePage 10

CBCT Image Analysis Application — Architecture Overview

Broadcast payloads use typed events (`step_started`, `step_progress`, `step_completed`,
`pipeline_completed`, `pipeline_failed`, `pipeline_cancelled`) with progress, step, and error
fields as needed. The client uses these to update a progress display.
On `step_completed`, the payload may include an `artifacts` map (FileRecord
`viewer_purpose` → file id) for files committed by that step. The frontend may use a
`viewer_volume` id from this map for mid-pipeline scan preview only.
On `pipeline_completed`, the payload carries status and progress only — not file ids. The
frontend confirms the study is ready via REST, then loads viewer files the same way as
Browse → Open: `GET /storage/studies/{study_id}/files?viewer_purpose=viewer_volume,viewer_overlay`.
On reconnect, the broadcaster may replay the last in-memory progress snapshot (enriched with
committed mid-run artifacts when available) or a coarse DB hydrate frame. Disconnect does not
cancel the job; the pipeline continues running regardless.
When the client disconnects, the WebSocket handler unregisters the socket from the
broadcaster. The pipeline continues running regardless — disconnection does not cancel the
job.

- Application Startup and Shutdown
The FastAPI lifespan function handles initialization and teardown in a defined order.

In startup case the following is dispatched:
● Creating SQLite schema
● Wiping UploadSession records in state active (active on startup means those jobs were
abandoned from a previous run)
● StorageService.sweep_orphans() scans data/blobs/ for files whose hardlink count
(st_nlink) is 1 — meaning no study hardlink points to them — and removes them
● WorkerPool is created
● LocalStorageEngine, StorageService, WSBroadcaster, StudyService, and
JobPipelineService are instantiated and wired together
During the shutdown, all in-flight asyncio tasks are canceled and the process pool is drained

## 7. Key Design Guarantees

## Guarantee

## Mechanism

Resumable uploads
Chunk writes are idempotent. The client can call
the status endpoint on reconnect to see which
indices are confirmed, then re-send remaining
chunks.
Upload integrity
SHA-256 and byte size are declared at begin and
verified at finalize. Any mismatch raises 422
before any FileRecord is created.
File deduplication
CAS commit skips the blob move if the hash path
already exists. Re-uploading an identical file costs
only the upload bandwidth, not additional disk
space.
Memory safety
ONNX inference and DICOM conversion run in a
ProcessPoolExecutor. A crash or memory error in
a worker cannot affect the FastAPI event loop.
Internal — Implementation ReferencePage 11

CBCT Image Analysis Application — Architecture Overview

## Guarantee

## Mechanism

Non-blocking I/O
All subprocess calls are awaited via
loop.run_in_executor(). The FastAPI event loop is
never blocked by compute work.
Viewer uniqueness
Only one FileRecord with a specific purpose
(viewer\_volume or viewer\_overlay) may be
active per study. StorageService atomically nulls
any prior record with the identical purpose in the
same transaction as inserting the new one.
Clean study deletion
StudyService.delete() cancels any active
PipelineJob before removing database records
and filesystem hardlinks.
Worker pool extensibility
WorkerPool is a generic ProcessPoolExecutor
wrapper. A second pool with a different initializer
(e.g., a GPU pipeline) can be created in app.py
and injected into specific step classes without
touching JobPipelineService.
## 7. Example Flows
Flow A: Upload a NIfTI scan with automated segmentation

## #

## Actor

## Action

## Backend

1 User Enters study name 'Patient-001'
## GET
## /storage/studies?external_i
d=Patient-001 → 200, no
match
## 2 User
Selects a .nii.gz scan file, chooses
automated segmentation
## —
3 Frontend Begins upload session
POST /uploads:begin →
{upload_id, chunk_size}
4 Frontend Sends N chunks
## PUT
## /uploads/{id}/chunk?index=0
..N → 200 each
## 5 Frontend
Finalizes with pipelines=[{name:
segment_nifti}]
POST /uploads/{id}:finalize
→ {file_id, job_id}
## 6 Backend
Commits scan to CAS, creates
FileRecord (viewer_volume),
creates PipelineJob, starts asyncio
task
## —
7 Frontend Opens WebSocket
WS /ws/pipeline/{job_id} →
connected
Internal — Implementation ReferencePage 12

CBCT Image Analysis Application — Architecture Overview

## #

## Actor

## Action

## Backend

## 8
## Backend
## (worker)
Runs SegmentNiftiStep in
subprocess
## Broadcasts {status:
running, step:
segment_nifti, progress:
## 45}
## 9
## Backend
## (worker)
Step completes, stores mask as
FileRecord (viewer_overlay)
## Broadcasts {status:
completed, overlay_file_id:
## <id>}
## 10 Frontend
Receives completed event, opens
NiiVue viewer with volume + overlay
## —

Flow B: Upload a DICOM directory with automated segmentation

## #

## Actor

## Action

## Backend

1 User Selects a DICOM directory
## —
## 2 Frontend
Compresses DICOM slices
into a .zip archive client-side
## —
## 3 Frontend
Begins upload session with
kind=dicom_zip
POST /uploads:begin →
{upload_id, chunk_size}
## 4 Frontend
Sends chunks, finalizes with
pipelines=[{name:
segment_nifti}]
POST /uploads/{id}:finalize →
{file_id, job_id}
## 5 Backend
Detects kind=dicom_zip,
prepends DicomToNiftiStep
automatically. Steps:
## [dicom_to_nifti,
segment_nifti]
## —
## 6
## Backend
## (worker)
DicomToNiftiStep: extracts
ZIP, converts to NIfTI, stores
as FileRecord
## (viewer_volume)
Broadcasts step progress
## 7
## Backend
## (worker)
SegmentNiftiStep: runs
inference on converted
NIfTI, stores mask as
FileRecord (viewer_overlay)
Broadcasts step progress
## 8 Frontend
Receives completed event,
opens viewer
## —

Flow C: Resume an interrupted upload
Internal — Implementation ReferencePage 13

CBCT Image Analysis Application — Architecture Overview


## #

## Actor

## Action

## Backend

## 1 Frontend
Upload interrupted
after 12 of 20
chunks
## —
## 2
## Frontend
## (reconnect)
Calls status
endpoint
GET /uploads/{id}/status →
{uploaded_indices: [0..11], state:
active}
## 3 Frontend
Re-sends chunks
12–19 only
PUT /uploads/{id}/chunk?index=12..19 →
200 each
4 Frontend Finalizes normally
POST /uploads/{id}:finalize → {file_id,
job_id}

Flow D: Open a raw file (no persistence)

## #

## Actor

## Action

## Backend

## 1 User
Selects 'Open Raw
File' from the main
menu
## —
## 2 User
Picks a .nii.gz scan and
optionally a mask
## .nii.gz
## —
## 3 Frontend
Passes file references
directly to NiiVue
No backend calls
## 4 Frontend
NiiVue loads and
renders the volume
in-memory
## —
5 User Closes the viewer
Files are released from
memory; nothing
persisted

Flow E: Delete a study with an active pipeline

## #

## Actor

## Action

## Backend

## 1 User
Clicks delete on a study
currently processing
## —
## 2 Frontend
Calls DELETE
## /storage/studies/{study_id}
## —
Internal — Implementation ReferencePage 14

CBCT Image Analysis Application — Architecture Overview

## #

## Actor

## Action

## Backend

## 3 Backend
Finds active PipelineJob for
study, cancels asyncio task
PipelineJob.status → cancelled
## 4 Backend
Nulls FileRecord entries,
removes hardlinks from
data/studies/{id}/
## —
5 Backend Returns 204 Study record removed from DB
Internal — Implementation ReferencePage 15

CBCT Image Analysis Application — Architecture Overview


- API Reference Summary
REST Endpoints

## Method

## Path

## Description

GET /storage/studies
List all studies. Supports
?external_id= filter.
POST /storage/studies Create a new study.
PATCH /storage/studies/{study_id} Rename a study.
DELETE /storage/studies/{study_id}
Delete a study (cancels active
jobs first).
## POST
## /storage/studies/{study_id}/uplo
ads:begin
Start a chunked upload session.
## PUT
## /storage/uploads/{upload_id}/ch
unk
Upload a single chunk
(idempotent). Query param:
index.
## GET
## /storage/uploads/{upload_id}/sta
tus
Get upload session state and
uploaded chunk indices.
## POST
## /storage/uploads/{upload_id}:fin
alize
Finalize upload, commit to CAS,
dispatch pipeline.
GET /storage/studies/{study_id}/files
List FileRecords. Supports
?purpose= filter.
## GET
## /storage/studies/{study_id}/files/{
file_id}/content
Serve file bytes. Supports HTTP
## Range Requests.
WebSocket Endpoint

## Path

## Description

WS /ws/pipeline/{job_id}
Real-time pipeline progress. Broadcasts JSON
events with status, progress, step, error; optional
step_completed.artifacts for mid-run preview.
Completion has no file ids — client loads files via
REST using viewer_purpose.
## Pipeline Identifiers

## Identifier

Triggered by

## Step

dicom_to_nifti
Automatically when
kind=dicom_zip
DicomToNiftiStep — extracts
and converts DICOM ZIP to
NIfTI.
Internal — Implementation ReferencePage 16

CBCT Image Analysis Application — Architecture Overview

## Identifier

Triggered by

## Step

segment_nifti
User request via finalize
payload
SegmentNiftiStep — runs
ONNX inference, produces
segmentation mask.

FileRecord Kinds and Purposes

## Kind

## Role

## Purpose

## Source

nifti_raw original viewer_volume
User-uploaded NIfTI
scan.
nifti_mask original viewer_overlay
## User-uploaded
pre-computed
segmentation mask.
dicom_zip original null
User-uploaded DICOM
directory (zipped by
frontend).
nifti_derived derived viewer_volume
NIfTI produced by
DicomToNiftiStep.
segmentation_mask derived viewer_overlay
Mask produced by
SegmentNiftiStep.


Internal — Implementation ReferencePage 17

CBCT Image Analysis Application — Architecture Overview

- Proposed folder structure

backend/
├── main.py                   # Process entrypoint
├── app.py                    # FastAPI app factory, lifespan, middleware
├── config.py                 # Settings (paths, chunk size, TTL, model path)
├── schemas.py                # Shared Pydantic request/response models
├── exceptions.py             # Custom HTTP exceptions
## │
├── routers/
│   ├── studies.py            # Study CRUD endpoints
│   ├── uploads.py            # Chunked upload state machine endpoints
│   ├── files.py              # File content retrieval
│   └── ws.py                 # WebSocket progress endpoint
## │
├── services/
│   ├── upload_service.py       # Upload session lifecycle
│   ├── storage_service.py      # CAS commit + FileRecord creation
│   ├── study_service.py        # Study CRUD business logic
│   └── job_pipeline_service.py # JobPipelineService: step routing, dispatch, cancellation
## │
├── workers/
│   ├── steps/
│   │   ├── base.py             # PipelineStep protocol, StepContext, StepResult
│   │   ├── dicom_to_nifti.py   # DicomToNiftiStep
│   │   └── segment_nifti.py    # SegmentNiftiStep
│   ├── subprocesses/           # Subfolder for pure compute kernels
│   │   ├── dicom_fn.py         # Subprocess fn: convert_dicom(path) → path
│   │   └── segmentation_fn.py  # Subprocess fn: run_segmentation(path) → path
│   ├── pipeline_runner.py      # run_pipeline() async orchestrator
│   ├── worker_pool.py          # WorkerPool: generic ProcessPoolExecutor wrapper
│   └── ws_broadcaster.py       # WebSocket registry and broadcast
## │
├── db/
│   ├── models.py             # SQLAlchemy ORM models
│   ├── session.py            # Engine and SessionLocal factory
│   └── repos/
│       ├── upload_session_repo.py
│       ├── file_repo.py
│       └── pipeline_job_repo.py
## │
└── storage/
├── engine.py             # StorageEngine protocol
└── local_engine.py       # LocalStorageEngine implementation






Internal — Implementation ReferencePage 18

CBCT Image Analysis Application — Architecture Overview

## 10. Database Schemas

## Study

Tracks a logical case or patient study.
## Column Type Notes
id UUID (str) Primary Key
external_id str? Optional external reference,
## UNIQUE
status str created, processing, ready
created_at datetime Timestamp
updated_at datetime Timestamp
meta JSON Study-level metadata

FileRecord
A study‑scoped file handle with path mapping and viewer metadata.

## Column Type Notes
id UUID (str) Primary Key
study_id UUID (str) Foreign Key → Study
pipeline_job_id UUID? Foreign Key → PipelineJob
(null for raw uploads)
Internal — Implementation ReferencePage 19

CBCT Image Analysis Application — Architecture Overview

role str Provenance: original / derived
kind str? dicom_zip / nifti_raw /
nifti_mask / nifti_derived /
segmentation_mask
purpose str? UI Intent: null / viewer_volume /
viewer_overlay (only 1 active
overlay/volume per study)
rel_path str Path relative to data root
## (data/studies/{id}/...)
original_filename str Original upload filename;
persisted here because
UploadSession is ephemeral
blob_hash str(64) Foreign Key → Blob.hash,
serves as true CAS pointer
content_type str? MIME type
size int Stored Size (Bytes)
created_at datetime Timestamp
meta JSON NIfTI header info (shape,
pixdim, affine, zooms, etc.)
or DICOM info
UploadSession

Tracks the resumable chunked upload state machine.
## Column Type Notes
Internal — Implementation ReferencePage 20

CBCT Image Analysis Application — Architecture Overview

id UUID (str) Primary Key
study_id UUID (str) Foreign Key → Study
role str Assigned target role
kind str Assigned target kind
filename str Original uploaded filename
content_type str? MIME type
expected_size int? Total bytes declared by client
expected_sha256 str? Hash declared by client for finalize verification
chunk_size int Negotiated chunk size
state str active / finalized / aborted / expired
created_at datetime Tracks session activity;
updated_at datetime
PipelineJob

Replaces the old POC Task model. Defines a background processing execution.
## Column Type Notes
id UUID (str) Primary Key, returned to client as job_id
Internal — Implementation ReferencePage 21

CBCT Image Analysis Application — Architecture Overview

study_id UUID (str) Foreign Key → Study
source_file_id UUID (str) Foreign Key → FileRecord that triggered the job
steps JSON Audit log array of step names (e.g., ["DicomToNiftiStep",
"SegmentNiftiStep"])
status str queued / running / completed / failed / cancelled
created_at datetime Timestamp
started_at datetime? Execution start
finished_at datetime? Execution finish
error str? Populated on pipeline failure
## Blob

One row per uniquely hashed file content (CAS deduplication).
## Column Type Notes
hash str(64) Primary Key (SHA-256)
size int File size in bytes
created_at datetime Timestamp

Internal — Implementation ReferencePage 22