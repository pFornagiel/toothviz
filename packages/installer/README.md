# ToothViz installer

Builds ToothViz into one installer per operating system. The installed app
contains everything it needs (Electron, the React UI, a frozen Python backend
and the segmentation model), so users don't install Python, uv or Node.

| OS      | File                                    | What the user does                               |
|---------|-----------------------------------------|--------------------------------------------------|
| Windows | `ToothViz-Setup-<version>-windows-x64.exe` | Double-click it. It installs and starts ToothViz. |
| macOS   | `ToothViz-<version>-macos-<arch>.dmg`   | Open it, drag ToothViz into Applications.        |
| Linux   | `ToothViz-<version>-linux-x86_64.AppImage` | Make it executable, double-click it.           |
| Linux   | `ToothViz-<version>-linux-amd64.deb`    | Debian/Ubuntu: open it with the software installer. |

## Building

PyInstaller can't cross-compile, so build each installer on its own OS.

**Prerequisites:** [uv](https://docs.astral.sh/uv/), Node.js 20+ with npm, and
the model files (`git lfs pull`).

```bash
uv run python packages/installer/build.py
```

The files land in `packages/installer/release/`. A build takes a few minutes.
It runs these steps:

1. `npm ci` and `npm run build` in `application/frontend` and `application/desktop`
2. PyInstaller freezes `backend_entry.py` into `build/toothviz-backend/`, from a
   venv that holds only the runtime dependencies
3. electron-builder (pinned in this package) packages it all using
   `electron-builder.config.cjs`

### All platforms at once (GitHub Actions)

`.github/workflows/installer.yml` builds on Windows, macOS (Apple Silicon and
Intel) and Linux. Each job installs its installer the way a user would and runs
the smoke test, and an extra job tests the Linux builds on Ubuntu 24.04. Start
it from the Actions tab ("Installers" → "Run workflow"), or push a `v*` tag.
The installers and a screenshot of each running app are attached to the run.

## Checking a build

```bash
uv run python packages/installer/smoke_test.py            # unpacked app in release/
uv run python packages/installer/smoke_test.py <app-exe>  # e.g. the AppImage, an installed app
```

The smoke test starts the app, waits for the window to load the UI and saves a
screenshot. It then runs a real segmentation and a DICOM conversion through
the bundled backend, kills the app and checks the backend stopped too. On a
Linux machine without a display, run it under `xvfb-run`.

## How it works

```text
packages/installer/
├── build.py                    one command that builds the installer
├── backend_entry.py            PyInstaller entry: starts uvicorn with backend.app
├── electron-builder.config.cjs packaging config (replaces the "build" section of desktop/package.json)
├── smoke_test.py               end-to-end check of a built app
├── assets/entitlements.mac.plist
└── package.json                pins electron-builder
```

Inside the installed app (`resources/`):

```text
app.asar                     Electron main + preload (unchanged desktop code)
application/frontend/dist/   React UI, served by the backend
backend/toothviz-backend     frozen FastAPI backend + its worker processes
models/                      lite_mobile_unet_5ch ONNX model
```

When a packaged app has `resources/backend/toothviz-backend`, Electron starts
it in place of `uv run uvicorn`, with the same environment variables. Dev mode
(`make desktop-dev`) and `make desktop-dist` still use uv as before. The
backend watches its stdin and exits once Electron is gone, even after a crash.

User data (scans, database) and logs live in the per-user folder, which is
kept when the app is uninstalled or updated:

| OS      | Folder                                 |
|---------|----------------------------------------|
| Windows | `%APPDATA%\ToothViz`                   |
| macOS   | `~/Library/Application Support/ToothViz` |
| Linux   | `~/.config/ToothViz`                   |

If the app fails to start, the error dialog shows where the logs are
(`logs/app.log` in that folder).

## Notes for users

These builds aren't signed with a paid certificate, so the OS warns on first
launch:

- **Windows:** "Windows protected your PC" → *More info* → *Run anyway*.
- **macOS:** "Apple could not verify ToothViz…" → *Done*, then *System
  Settings → Privacy & Security* → *Open Anyway*. This is needed only once.
- **Linux AppImage:** right-click → *Properties* → *Allow executing as program*
  (or `chmod +x ToothViz-*.AppImage`).

## Signing (optional)

electron-builder signs automatically when the certificates are set in the
environment:

- **macOS:** `CSC_LINK` (a .p12 "Developer ID Application" cert, as a path or
  base64) and `CSC_KEY_PASSWORD`. For notarization, which removes the Gatekeeper
  warning, also set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
  With a certificate, the hardened runtime and `assets/entitlements.mac.plist` are used.
- **Windows:** `CSC_LINK` / `CSC_KEY_PASSWORD` with an Authenticode certificate.

Signed builds haven't been tested yet: no certificates were available.
