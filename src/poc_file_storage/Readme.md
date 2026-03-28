## CBCT Storage (PoC)

## 0) Glossary
- **CAS (Content‑Addressed Storage)** - Files stored by hash (SHA‑256) so identical content is deduplicated.
- **Originals** vs **Derivatives** - Originals are the uploaded scans; derivatives are outputs (segmentation masks, denoise, labels, thumbnails, logs).
- **Study** - A case/folder that groups originals and derivatives.

## 1) Directory layout
```
poc-file-storage/
├── storage/
│ ├── init.py
│ ├── abstract.py
│ ├── models.py
│ └── local.py
├── api/
│ └── storage_router.py
├── tests/
│ └── test_storage_local.py
├── upload_nifti.sh
├── main.py # small FastAPI launcher (just for local testing purpose)
├── data/ # created at runtime
└── storage.sqlite3 # created at runtime
```

- **storage/** — storage package (abstract API + local implementation + DB models)
- **api/** — minimal FastAPI router exposing resumable upload endpoints
- **tests/** — pytest validating the happy path
- **upload_nifti.sh** — robust bash script to upload a NIfTI file in chunks (test purpose)
- **data/** — runtime folder with blobs and study folders
- **storage.sqlite3** — SQLite database with storage metadata

## 2) How It Works

1. **Create a study** - This allocates metadata and folders (raw/, derived/, ...)
2. **Upload Original NIfTI** - Done in chunks via HTTP or directly from local path:
- Chunks are saved in a temporary upload directory.
- On finalize: chunks are stitched, SHA‑256 is computed, and the file is moved atomically into CAS under data/blobs/sha256/....
- A hardlink (or copy fallback) is created in the study’s raw/ folder with your supplied filename.
- A DB FileRecord is inserted; optional NIfTI header metadata (shape, spacing, affine) is captured through nibabel.
3. Save Derivatives — Pipeline (e.g., MONAI) writes outputs (segmentation, denoise) to disk and registers them via store_from_local_path(); hardlinks are created in derived/ with metadata recorded.
4. List / Read — You can query files and stream them to clients (e.g., Niivue).


### Why this design?

- **CAS** provides:
  - **Deduplication** — identical content stored once.
  - **Integrity** — hash is a verifiable fingerprint.
- **Hardlinks** from studies to blobs:
  - **O(1)** clone/link.
  - Deleting a per‑study file only removes the link, not the blob.
  - Blobs are garbage‑collected when unreferenced.


## 3) Runtime folder Structure
```
data/
├── blobs/sha256/ab/<sha256-hash> # Immutable content files
│ ├── init.py
│ ├── abstract.py
│ ├── models.py
│ └── local.py
├── studies/<study_id>/
│ ├── raw/  # Hardlinks to CAS for originals
│ ├── derived/  # Hardlinks for derivatives (masks, denoise, etc.)
│ ├── thumbs/
│ └── logs/
└──uploads/<upload_id>
  ├── thumbs/
  └── logs/
```

## 4) Database Schema (SQLAlchemy ORM)

### 3.1 `Study`
Tracks a logical case.

| Column        | Type       | Purpose                                  |
|---------------|------------|-------------------------------------------|
| `id`          | `str(uuid)`| Primary key (internal).                   |
| `external_id` | `str?`     | External reference (optional).            |
| `status`      | `str`      | e.g., `created`, `processing`, `ready`.   |
| `created_at`  | `datetime` | Timestamp.                                |
| `meta`        | `JSON`     | Study‑level metadata (pseudonymous).      |

### 3.2 `Blob`
One row per unique content.

| Column       | Type       | Purpose               |
|--------------|------------|------------------------|
| `hash`       | `str(64)`  | SHA‑256 (primary key). |
| `size`       | `int`      | File size in bytes.    |
| `created_at` | `datetime` | Timestamp.             |

### 3.3 `FileRecord`
A study‑scoped “file handle” with path + metadata.

| Column            | Type        | Purpose                                                       |
|-------------------|-------------|----------------------------------------------------------------|
| `id`              | `str(uuid)` | Primary key.                                                  |
| `study_id`        | `str`       | FK → `Study`                                                 |
| `role`            | `str`       | original/derived/thumb/log                                 |
| `kind`            | `str?`      | nifti/segmentation/denoise/labels/png/...                 |
| `rel_path`        | `str`       | Path under `data/` to the per‑study link.                    |
| `blob_hash`       | `str(64)`   | FK → `Blob.hash`.                                             |
| `content_type`    | `str?`      | MIME type, e.g., `application/gzip` for `.nii.gz`.           |
| `size`            | `int`       | Stored size.                                                  |
| `checksum_sha256` | `str(64)`   | Equals `blob_hash` for convenience.                           |
| `created_at`      | `datetime`  | Timestamp.                                                    |
| `meta`            | `JSON`      | File‑level metadata (NIfTI header, model info, etc.).         |

### 3.4 `UploadSession`
Resumable upload state.

| Column            | Type        | Purpose                                             |
|-------------------|-------------|------------------------------------------------------|
| `id`              | `str(uuid)` | Upload session ID.                                   |
| `study_id`        | `str`       | FK → `Study`.                                        |
| `role`            | `str`       | Target `role` for final link.                        |
| `kind`            | `str`       | Target `kind` for final metadata.                    |
| `filename`        | `str`       | Target filename under study.                         |
| `content_type`    | `str?`      | MIME type.                                           |
| `expected_size`   | `int?`      | For verification on finalize                        |
| `expected_sha256` | `str(64)?`  | Optional integrity check on finalize.                |
| `created_at`      | `datetime`  | Timestamp.                                           |
| `state`           | `str`       | e.g. `active` or `finalized` or `aborted` 


## 4) File-by-File Docs

### 4.1 `storage/abstract.py`

**What it contains**
- `StoredFile` dataclass — a uniform descriptor returned by storage operations:
  - `id`, `study_id`, `role`, `kind`, `rel_path`, `size`, `checksum_sha256`, `blob_hash`, `content_type`, `created_at`, `meta`.
- `AbstractPersistentStorage` — the interface our app depends on (not the implementation):
  - **Study lifecycle**: `create_study`, `ensure_study`, `save_metadata`, `get_metadata`.
  - **Resumable upload**: `begin_upload` → `upload_chunk` → `finalize_upload`.
  - **Server‑side store**: `store_from_local_path` (for pipeline outputs already on disk).
  - **Query/IO**: `list_files`, `get_file`, `open_file`.
  - **Maintenance**: `delete_file`, `garbage_collect`, `dispose`.

**Why this matters**
- The rest of our code (FastAPI endpoints, Celery tasks, MONAI pipelines) only import this interface and a concrete implementation.  
- Later, there can be added `S3PersistentStorage` or `MinIOPersistentStorage` without changing callers.

---

### 4.2 `storage/models.py`

**What it contains**
- SQLAlchemy ORM models: `Study`, `Blob`, `FileRecord`, `UploadSession`.
- Indices and constraints for performance and data integrity (e.g., `(role, kind)` index; unique per‑study `rel_path`).

**Why this matters**
- Stores **metadata only**; large binaries stay on disk → fast, cheap, and resilient.
- Portable: for example SQLite in dev and PostgreSQL in production (just change the DB URL).

---

### 4.3 `storage/local.py`

**What it is**
- A robust local filesystem implementation of `AbstractPersistentStorage`.

**Key behaviors**

1) **Init**
   - Creates folder structure under `data/`:
     - `blobs/sha256/`, `studies/`, `uploads/`.
   - SQLite is configured with **WAL** (better concurrency for single node dev).

2) **Create/Ensure Study**
   - Insert `Study` row if missing.
   - Create per‑study folders: `raw/`, `derived/`, `thumbs/`, `logs/`.

3) **Resumable Upload**
   - **`begin_upload`**: Create an `UploadSession` + `uploads/<upload_id>/meta.json`.
   - **`upload_chunk`**: Write `part_XXXXXXXX.chunk` files. Idempotent with size check.
   - **`finalize_upload`**:
     - **Stitch** parts into `concat.tmp` and compute `(sha256, size)`.
     - Verify against `expected_size` and `expected_sha256` if provided.
     - Move into CAS path `blobs/sha256/<sha>` **atomically** (`os.replace`).
     - **Hardlink** into `studies/<sid>/<role-dir>/<filename>` (fallback to copy if not same filesystem).
     - If file is `.nii`/`.nii.gz` and `nibabel` is installed, parse header (shape, spacing/zoom, affine) into `FileRecord.meta`.
     - Insert `FileRecord` and mark session as `finalized`.
     - Remove staged `parts/`.

4) **Server‑side Store**
   - **`store_from_local_path`**: For ML outputs already saved to disk:
     - Compute SHA‑256; install to CAS if new; hardlink into study; capture optional NIfTI metadata; insert `FileRecord`.

5) **Query/IO/Maintenance**
   - `list_files(study_id, role?, kind?)` - list metadata.
   - `open_file(file_id)` - read‑only file handle.
   - `delete_file(file_id)` - remove the per‑study link for derivatives (originals protected).
   - `garbage_collect(dry_run)` - remove unreferenced blobs and DB rows safely.

**Why this matters**
- **Large‑file friendly** (chunking, streaming, no memory spikes).
- **Integrity & dedupe** with CAS.
- **Atomic** finalize = no partial/corrupted files in study folders.
- **NIfTI‑aware** (header capture) to make downstream steps easier.

---

### 4.4 `api/storage_router.py`

**What it contains**
- A small FastAPI `APIRouter` that exposes the resumable upload protocol:
  - `POST /storage/studies/{study_id}/uploads:begin` → returns `{upload_id}`.
  - `PUT  /storage/uploads/{upload_id}/chunk?index=<i>` → accepts a chunk as multipart field `chunk`.
  - `POST /storage/uploads/{upload_id}:finalize` → returns `{file_id, rel_path, size, sha256}`.

**Why this matters**
- We can test real uploads **now** (no full app needed).
- The final application will likely call the same storage methods behind richer endpoints.

---

### 4.5 `tests/test_storage_local.py`

**What it does**
- A tiny pytest “happy path”:
  - Create a study,
  - Upload mock file in two parts,
  - Finalize,
  - Store a fake segmentation from a local path,
  - List, open, and read bytes from it,
  - Delete the derivative.

**Why this matters**
- Validates the most important behavior is wired correctly on your machine.

---

### 4.6 `upload_nifti.sh` - END-TO-END file storage **test**

**Overview**
- A robust bash script that uploads a `.nii.gz` file in multiple chunks using the HTTP endpoints.
- Uses `jq` to build valid JSON (avoids shell‑quoting problems).

**What it does step‑by‑step**
1. **Parse inputs**: `STUDY_ID` (arg1) and `FILE` (arg2 or default).
2. **Compute file size** in bytes (macOS or Linux syntax).
3. **Optionally compute SHA‑256** (via `shasum` or `sha256sum`).
4. **Build JSON** with `jq`. Includes expected size and optionally checksum.
5. **BEGIN** upload: `POST /uploads:begin` → get `upload_id`.
6. **Send chunks**:
   - Loop over file using `dd` with `bs=$CHUNK_SIZE` and `skip=$i`.
   - `PUT /uploads/<upload_id>/chunk?index=$i` with chunk as `multipart/form-data` field `chunk`.
7. **FINALIZE**: `POST /uploads/<upload_id>:finalize` → returns `file_id`, `rel_path`, `size`, `sha256`.
8. **Print final location** of the file in the study folder.

**Why this matters**
- Provides an end‑to‑end test of resumable uploads using your storage backend.

---

## 5) How It Fits Into the Project

- **FastAPI**:
  - Creates studies (`POST /studies`), triggers pipeline, exposes file lists and read URLs.
  - Uses the same storage API methods (`begin_upload`, `finalize_upload`, `list_files`, `open_file`).
- **Celery Workers**:
  - After finalize, workers read originals with `open_file(file_id)`/direct path, run MONAI preprocessing and inference.
  - Write outputs and call `store_from_local_path(..., role="derived", kind="segmentation", ...)`.
- **Niivue (Frontend)**:
  - Loads raw NIfTI and overlay segmentation via HTTP from `data/studies/<sid>/...`.
  - Serve `/data/studies/...` under a static route (Nginx) with `Accept‑Ranges: bytes` for range requests.

---

## 6) Set‑Up & Testing

### 6.1 Install Dependencies (one time)

```bash
cd /path/to/poc-file-storage
python3 -m venv .venv
source .venv/bin/activate
pip3 install -U pip3
pip3 install sqlalchemy filelock nibabel numpy fastapi uvicorn pydantic pytest jq
```
*jq is a CLI JSON tool: macOS (brew install jq), Ubuntu/Debian (sudo apt-get install jq)*

### 6.2 Programmatic Test (no HTTP)

1. Put your real CBCT NIfTI at project root as tooth_cbct.nii.gz (or use any path you prefer).
2. Create a sample script scripts/test_programmatic.py.

Run
```bash
python scripts/test_programmatic.py
```

Inspect results:
```bash
find data/studies -maxdepth 3 -type f | sort
```

### 6.3 HTTP Test (resumable upload)

1. Use minimal FastAPI app runner (main.py)

```bash
uvicorn main:app --reload
```

2. Create a study
```
python3 create_study.py
```
Copy the printed `STUDY_ID`.

3. Run the upload script:
```bash
chmod +x upload_nifti.sh
./upload_nifti.sh <STUDY_ID> test_cbct.nii.gz
```
4. Verify
```bash
find data/studies -maxdepth 3 -type f | sort
```

and check nifti file nibabel params (shape, zooms):
```bash
chmod +x load_stored_file.py
python3 ./load_stored_file.py
```

### 6.4 happy path test

`tests/test_storage_local.py` includes simple happy path test but with no real nifti file, run it by `pytest -q`.

## 7) Additional Notes

- **Garbage Collection**
    ```python
    from storage.local import LocalPersistentStorage
    s = LocalPersistentStorage()
    print(s.garbage_collect(dry_run=True))   # preview orphans
    print(s.garbage_collect(dry_run=False))  # delete orphans
    s.dispose()
    ```
- **Backups**
    Because the storage backend uses **Local File Storage + SQLite**, backups are simple and fully supported:

    1. **Back up `storage.sqlite3`**  
    This file contains all metadata: studies, file records, blob references, and upload sessions.

    2. **Back up the CAS directory: `data/blobs/`**  
    This folder contains the **actual binary content** of every uploaded NIfTI, segmentation mask, thumbnail, and other derived files.  
    Each blob is immutable and identified by its SHA‑256 hash.

    3. **Why you *don’t* need to back up `data/studies/...`**  
    The per‑study folders contain **only hardlinks** to blob files.  
    If those study folders were lost, they can be **fully reconstructed** from:
    - entries in `storage.sqlite3`, and  
    - blob files in `data/blobs/`.

    Therefore, a complete backup consists only of `storage.sqlite3` and `data/blobs/`. When restored, the application can regenerate all per‑study paths automatically during startup or as part of a repair routine.


- **NIfTI Metadata**

    - If nibabel is installed, FileRecord.meta["nifti"] contains:

        ```
        shape: volume dimensions
        pixdim: voxel spacing
        affine: 4×4 spatial transform
        ```

## 8) Running the Final System in Docker (Local File Storage + SQLite)

In the final system, the storage backend (`LocalPersistentStorage`) uses:

- a **local directory** (e.g., `/app/data`) to store all NIfTI volumes, segmentation masks, thumbnails, and logs,
- a **SQLite database file** (e.g., `/app/storage.sqlite3`) to store metadata about studies and files.

When running in Docker, both must be mounted as **persistent volumes**, so data survives container rebuilds and can be inspected from the host system.


## 9) Space For Future Development

1) **SQLite** -> **PostreSQL**: SQLite works well for single‑node deployments; switching to PostgreSQL later is straightforward.
- Change DB URL to: postgresql+psycopg://user:pass@host/dbname.
- Use Alembic for migrations (future enhancement).

2) Add **S3/MinIO/Azurite** backend: the local directory (./data) can be replaced with a network-mounted volume or object storage backend in the future
- Implement another class S3PersistentStorage(AbstractPersistentStorage) with the same API.
- Use presigned URLs for Niivue downloads.

*Current design cleanly supports fast local development and small‑scale deployments without infrastructure overhead*

## 10) Summary

This storage layer is **NIfTI‑first**, **large‑file friendly**, and **reliable**:

- Resumable chunk uploads, atomic finalize, SHA‑256 integrity, CAS dedupe.
- Only metadata in DB; binaries in filesystem for performance and cost.
- Optional NIfTI header capture to ease downstream visualization and ML.

Everything can be tested today without complete system readiness:

- The programmatic script to store and read files.
- The HTTP upload script (upload_nifti.sh) to simulate realistic uploads.

