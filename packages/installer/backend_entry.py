"""Entry point of the frozen backend shipped inside the desktop installers.

PyInstaller turns this file into ``toothviz-backend``. Electron starts it in
place of ``uv run uvicorn backend.app:app`` and passes the same ``TOOTH_*``
environment variables, so the backend code runs unchanged.
"""

import multiprocessing
import os
import sys
import threading
import time
from pathlib import Path


def _stop_when_parent_exits(server) -> None:
    """Shut down once Electron is gone, even if it crashed without killing us.

    Not done by reading a stdin pipe: on Windows a blocked pipe read stalls
    the worker processes from starting.
    """
    parent = os.getppid()
    if sys.platform == "win32":
        import ctypes

        synchronize, infinite = 0x00100000, 0xFFFFFFFF
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(synchronize, False, parent)
        kernel32.WaitForSingleObject(handle, infinite)  # returns at once if already gone
    else:
        # An orphaned process is re-parented, so its parent pid changes.
        while os.getppid() == parent:
            time.sleep(1)
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
    if "--exit-with-parent" in sys.argv:
        threading.Thread(target=_stop_when_parent_exits, args=(server,), daemon=True).start()
    server.run()


if __name__ == "__main__":
    # Lets the segmentation / DICOM worker processes start from the frozen exe.
    multiprocessing.freeze_support()
    main()
