"""Entry point of the frozen backend shipped inside the desktop installers.

PyInstaller turns this file into ``toothviz-backend``. Electron starts it in
place of ``uv run uvicorn backend.app:app`` and passes the same ``TOOTH_*``
environment variables, so the backend code runs unchanged.
"""

import multiprocessing
import os
import sys
import threading
from pathlib import Path


def _stop_when_stdin_closes(server) -> None:
    """Shut down once Electron is gone, even if it crashed without killing us.

    Electron holds the write end of our stdin; the OS closes it when Electron
    exits for any reason, which ends this read.
    """
    sys.stdin.buffer.read()
    server.should_exit = True


def main() -> None:
    # Keep logs next to the user's data, not inside the read-only install folder.
    data_root = os.getenv("TOOTH_DATA_ROOT")
    if data_root:
        os.environ.setdefault("TOOTH_LOG_DIR", str(Path(data_root).parent / "logs"))

    # Imported here so worker processes (which re-run this file) skip them.
    import uvicorn

    from backend import config
    from backend.app import app

    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=config.BACKEND_HOST,
            port=config.BACKEND_PORT,
            log_config=None,  # keep the backend's own logging setup
            access_log=False,
        )
    )
    if "--watch-stdin" in sys.argv:
        threading.Thread(target=_stop_when_stdin_closes, args=(server,), daemon=True).start()
    server.run()


if __name__ == "__main__":
    # Lets the segmentation / DICOM worker processes start from the frozen exe.
    multiprocessing.freeze_support()
    main()
