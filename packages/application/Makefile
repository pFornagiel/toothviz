.PHONY: help run run-dummy run-normal dev dev-dummy test install \
	desktop-install desktop-dev desktop-build desktop-dist

help:
	@echo "Tooth - Available commands:"
	@echo "  make run            - Run app with normal segmentation (default)"
	@echo "  make run-normal     - Run app with normal segmentation"
	@echo "  make run-dummy      - Run app with dummy fast segmentation (for testing)"
	@echo "  make dev            - Run with auto-reload"
	@echo "  make dev-dummy      - Run dev mode with dummy segmentation"
	@echo "  make desktop-dev    - Run Electron desktop app (dev)"
	@echo "  make desktop-build  - Build Electron app (compile)"
	@echo "  make desktop-dist   - Build installable desktop package"
	@echo "  make test           - Run tests"
	@echo "  make install        - Install dependencies with uv"

# Default target
run: run-normal

run-normal:
	@echo "Starting app with PROD segmentation..."
	uv run uvicorn backend.app:app --host 0.0.0.0 --port 8000

run-dummy:
	@echo "Starting app with DUMMY fast segmentation..."
	SEGMENTATION_MODE=dummy uv run uvicorn backend.app:app --host 0.0.0.0 --port 8000

dev: 
	@echo "Starting dev server with NORMAL segmentation..."
	uv run uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000

dev-dummy:
	@echo "Starting dev server with DUMMY fast segmentation..."
	SEGMENTATION_MODE=dummy uv run uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000

test:
	uv run pytest packages/application/tests -v

install:
	uv sync

desktop-install:
	cd desktop && npm install
	cd frontend && npm install

desktop-dev: desktop-install
	cd desktop && npm run dev

desktop-build: desktop-install
	cd desktop && npm run build

desktop-dist: desktop-install
	cd desktop && npm run dist
