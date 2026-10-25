"""Build the ToothViz installer for the operating system this runs on.

    uv run python packages/installer/build.py

Output in packages/installer/release/:

    Windows  ToothViz-Setup-<version>-windows-x64.exe   (installer)
    macOS    ToothViz-<version>-macos-<arch>.dmg         (drag to Applications)
    Linux    ToothViz-<version>-linux-x86_64.AppImage    (single executable)
             ToothViz-<version>-linux-amd64.deb          (Debian / Ubuntu package)

PyInstaller cannot cross-compile, so each installer must be built on its own
OS. .github/workflows/installer.yml does that for all three.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

PYINSTALLER = "pyinstaller==6.16.0"

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
APPLICATION = REPO / "packages" / "application"
BUILD = HERE / "build"
RELEASE = HERE / "release"
MODEL = REPO / "packages" / "models" / "lite_mobile_unet_5ch" / "exports" / "lite_mobile_unet_5ch.onnx"


def run(*cmd: str | Path, cwd: Path = REPO, env: dict | None = None) -> None:
    print(f"\n$ {' '.join(map(str, cmd))}", flush=True)
    subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, check=True)


def tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        sys.exit(f"'{name}' was not found on PATH. See packages/installer/README.md for prerequisites.")
    return path


def check_model() -> None:
    for f in (MODEL, MODEL.with_suffix(".onnx.data")):
        if not f.exists() or f.read_bytes()[:40].startswith(b"version https://git-lfs"):
            sys.exit(f"{f} is missing or only a Git LFS pointer. Run `git lfs pull` first.")


def build_electron(npm: str) -> None:
    """Frontend (React) and Electron main/preload, with their locked dependencies."""
    run(npm, "ci", cwd=APPLICATION / "frontend")
    run(npm, "ci", cwd=APPLICATION / "desktop")
    run(npm, "run", "build", cwd=APPLICATION / "desktop")


def build_backend(uv: str) -> None:
    """Freeze FastAPI + the processing stack into build/toothviz-backend/.

    Uses its own venv with only the runtime dependencies (no pytest etc.).
    """
    env = {**os.environ, "UV_PROJECT_ENVIRONMENT": str(BUILD / "venv")}
    run(
        uv, "run", "--frozen", "--no-dev", "--with", PYINSTALLER,
        "pyinstaller", "--noconfirm", "--clean", "--log-level", "WARN",
        "--name", "toothviz-backend",
        "--distpath", BUILD, "--workpath", BUILD / "pyinstaller", "--specpath", BUILD / "pyinstaller",
        "--paths", APPLICATION,
        # Worker functions are loaded by name inside the worker processes.
        "--collect-submodules", "backend",
        # Only named as a string in backend/logging.py's config.
        "--hidden-import", "colorlog",
        HERE / "backend_entry.py",
        env=env,
    )


def package(npm: str, npx: str) -> None:
    """Wrap everything into the installer with this package's electron-builder."""
    shutil.rmtree(RELEASE, ignore_errors=True)
    run(npm, "ci", cwd=HERE)
    run(
        npx, "electron-builder",
        "--projectDir", APPLICATION / "desktop",
        "--config", HERE / "electron-builder.config.cjs",
        "--publish", "never",
        cwd=HERE,
    )


def main() -> None:
    npm, npx, uv = tool("npm"), tool("npx"), tool("uv")
    check_model()
    build_electron(npm)
    build_backend(uv)
    package(npm, npx)
    print(f"\nDone. Installers are in {RELEASE}:")
    for f in sorted(RELEASE.iterdir()):
        if f.is_file() and f.suffix in (".exe", ".dmg", ".AppImage", ".deb"):
            print(f"  {f.name}  ({f.stat().st_size / 2**20:.0f} MB)")


if __name__ == "__main__":
    main()
