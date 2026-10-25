"""Launch a packaged ToothViz build and check that it works end to end.

    uv run python packages/installer/smoke_test.py [APP_EXECUTABLE] [-- extra app args]

Without APP_EXECUTABLE the unpacked app in ``packages/installer/release`` is
used. The script:

1. starts the app the way a user would, with Chrome's remote debugging on;
2. waits for the window to load the UI from the bundled backend and saves a
   screenshot of it;
3. runs real work through that backend: ONNX segmentation of a NIfTI scan and
   DICOM -> NIfTI conversion, both in the frozen worker processes;
4. kills the app hard and checks the backend shuts itself down.

It deletes the studies it creates. On Linux it also runs with a throwaway
config folder, so nothing touches the real ToothViz data.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from websockets.sync.client import connect

HERE = Path(__file__).resolve().parent
TEST_FILES = HERE.parent / "application" / "test_files"
SCREENSHOT = HERE / "release" / f"smoke-test-{sys.platform}.png"

STARTUP_TIMEOUT = 180
PIPELINE_TIMEOUT = 900


def default_executable() -> Path:
    release = HERE / "release"
    if sys.platform == "win32":
        return release / "win-unpacked" / "ToothViz.exe"
    if sys.platform == "darwin":
        app = next(release.glob("mac*/ToothViz.app"))
        return app / "Contents" / "MacOS" / "ToothViz"
    return release / "linux-unpacked" / "toothviz"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def http(method: str, url: str, body: bytes | dict | None = None) -> dict | None:
    headers = {}
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
    return json.loads(raw) if raw and res.headers.get_content_type() == "application/json" else None


def wait_for(what: str, timeout: float, check):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = check()
        except (OSError, urllib.error.URLError, ValueError):
            result = None
        if result:
            return result
        time.sleep(1)
    raise TimeoutError(f"Timed out after {timeout:.0f}s waiting for {what}")


class DevTools:
    """Just enough of the Chrome DevTools Protocol to inspect one page."""

    def __init__(self, ws_url: str) -> None:
        self._ws = connect(ws_url, max_size=None, open_timeout=30)
        self._next_id = 0

    def call(self, method: str, **params) -> dict:
        self._next_id += 1
        self._ws.send(json.dumps({"id": self._next_id, "method": method, "params": params}))
        while True:
            msg = json.loads(self._ws.recv(timeout=60))
            if msg.get("id") == self._next_id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg["result"]

    def evaluate(self, expression: str):
        return self.call("Runtime.evaluate", expression=expression, returnByValue=True)["result"].get("value")

    def close(self) -> None:
        self._ws.close()


def find_app_page(devtools_port: int) -> dict:
    """The window's page once it has loaded from the bundled backend."""
    with urllib.request.urlopen(f"http://127.0.0.1:{devtools_port}/json/list", timeout=5) as res:
        pages = json.loads(res.read())
    for page in pages:
        if page.get("type") == "page" and page.get("url", "").startswith("http://127.0.0.1:"):
            return page
    return {}


def run_pipeline(api: str, name: str, path: Path, kind: str, pipelines: list[dict]) -> str:
    """Upload ``path`` into a new study, wait for its pipeline, return the study id."""
    study = http("POST", f"{api}/storage/studies", {"name": f"{name} {time.time_ns()}"})
    data = path.read_bytes()
    upload = http(
        "POST",
        f"{api}/storage/studies/{study['id']}/uploads:begin",
        {"kind": kind, "filename": path.name},
    )
    chunk = upload["chunk_size"]
    for index, start in enumerate(range(0, len(data), chunk)):
        http("PUT", f"{api}/storage/uploads/{upload['upload_id']}/chunk?index={index}", data[start : start + chunk])
    http(
        "POST",
        f"{api}/storage/uploads/{upload['upload_id']}:finalize",
        {"expected_size": len(data), "pipelines": pipelines},
    )

    def finished():
        s = http("GET", f"{api}/storage/studies/{study['id']}")
        return s if s["pipeline_status"] in ("completed", "ready", "failed", "cancelled") else None

    started = time.monotonic()
    result = wait_for(f"pipeline of {name}", PIPELINE_TIMEOUT, finished)
    if result["pipeline_status"] not in ("completed", "ready"):
        raise RuntimeError(f"{name}: pipeline {result['pipeline_status']}: {result['error']}")
    print(f"  {name}: {result['pipeline_status']} in {time.monotonic() - started:.0f}s, steps={result['steps']}")
    return study["id"]


def make_dicom_zip(folder: Path, slices: int = 8, size: int = 32) -> Path:
    """A tiny synthetic CT series (the repo's sample DICOM is a single slice)."""
    import zipfile

    import numpy as np
    from pydicom.dataset import FileDataset, FileMetaDataset
    from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

    series, study = generate_uid(), generate_uid()
    archive = folder / "series.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        for i in range(slices):
            meta = FileMetaDataset()
            meta.MediaStorageSOPClassUID = CTImageStorage
            meta.MediaStorageSOPInstanceUID = generate_uid()
            meta.TransferSyntaxUID = ExplicitVRLittleEndian
            ds = FileDataset(f"{i}.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
            ds.is_little_endian, ds.is_implicit_VR = True, False
            ds.SOPClassUID, ds.SOPInstanceUID = CTImageStorage, meta.MediaStorageSOPInstanceUID
            ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
            ds.Modality, ds.PatientName, ds.PatientID = "CT", "Smoke^Test", "SMOKE"
            ds.InstanceNumber = i + 1
            ds.ImagePositionPatient = [0, 0, float(i)]
            ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
            ds.PixelSpacing, ds.SliceThickness = [1, 1], 1
            ds.Rows = ds.Columns = size
            ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
            ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
            ds.RescaleIntercept, ds.RescaleSlope = 0, 1
            ds.PixelData = np.full((size, size), i * 100, dtype=np.int16).tobytes()
            path = folder / f"{i}.dcm"
            ds.save_as(path, write_like_original=False)
            zf.write(path, path.name)
    return archive


def check_files(api: str, study_id: str, purpose: str) -> None:
    files = http("GET", f"{api}/storage/studies/{study_id}/files")
    match = [f for f in files if f["viewer_purpose"] == purpose]
    if not match:
        raise RuntimeError(f"study {study_id} has no {purpose} file: {files}")
    with urllib.request.urlopen(f"{api}/storage/studies/{study_id}/files/{match[0]['id']}/content") as res:
        size = len(res.read())
    print(f"    {purpose}: {match[0]['display_name']} ({size} bytes)")


def main() -> int:
    args = sys.argv[1:]
    extra = args[args.index("--") + 1 :] if "--" in args else []
    args = args[: args.index("--")] if "--" in args else args
    exe = Path(args[0]) if args else default_executable()
    if not exe.exists():
        sys.exit(f"App not found: {exe}\nBuild it first: uv run python packages/installer/build.py")

    work = Path(tempfile.mkdtemp(prefix="toothviz-smoke-"))
    env = dict(os.environ)
    if sys.platform.startswith("linux"):
        env["XDG_CONFIG_HOME"] = str(work)

    devtools_port = free_port()
    print(f"Launching {exe}")
    app = subprocess.Popen([str(exe), f"--remote-debugging-port={devtools_port}", *extra], env=env)
    try:
        def window_or_exit():
            if app.poll() is not None:
                raise RuntimeError(f"The app exited with code {app.returncode} before opening its window")
            return find_app_page(devtools_port)

        page = wait_for("the app window", STARTUP_TIMEOUT, window_or_exit)
        api = page["url"].split("/", 3)
        api = f"{api[0]}//{api[2]}"
        print(f"Window loaded {page['url']} (backend {api})")

        devtools = DevTools(page["webSocketDebuggerUrl"])
        wait_for(
            "the UI to render",
            60,
            lambda: devtools.evaluate("document.readyState === 'complete' && document.getElementById('root')?.childElementCount > 0"),
        )
        time.sleep(2)  # let fonts and the first layout settle for the screenshot
        title = devtools.evaluate("document.title")
        shot = devtools.call("Page.captureScreenshot", format="png")["data"]
        SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
        SCREENSHOT.write_bytes(base64.b64decode(shot))
        devtools.close()
        print(f"UI rendered (title {title!r}); screenshot saved to {SCREENSHOT}")

        print("Running pipelines through the bundled backend:")
        nifti = run_pipeline(api, "smoke: segmentation", TEST_FILES / "Iguana.nii.gz", "nifti_raw", [{"name": "segment_nifti"}])
        check_files(api, nifti, "viewer_volume")
        check_files(api, nifti, "viewer_overlay")
        series = make_dicom_zip(work)
        dicom = run_pipeline(api, "smoke: dicom", series, "dicom_zip", [])
        check_files(api, dicom, "viewer_volume")
        for study_id in (nifti, dicom):
            http("DELETE", f"{api}/storage/studies/{study_id}")

        print("Killing the app; the backend must stop on its own")
        app.kill()
        app.wait()

        def backend_gone():
            try:
                http("GET", f"{api}/storage/health")
            except (OSError, urllib.error.URLError):
                return True
            return False

        wait_for("the backend to shut down", 30, backend_gone)
    finally:
        if app.poll() is None:
            app.kill()
            app.wait()
        shutil.rmtree(work, ignore_errors=True)

    print("SMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
