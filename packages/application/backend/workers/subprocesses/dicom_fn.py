"""Pure compute: DICOM (ZIP or single .dcm) -> NIfTI conversion via dcm2niix.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.

dcm2niix (Chris Rorden) is the de-facto reference converter: it handles gantry
tilt, inconsistent slice increments, enhanced/multiframe objects and most
compressed transfer syntaxes that the previous dicom2nifti path silently
rejected. The bundled binary links OpenJPEG (JPEG 2000) and CharLS (JPEG-LS)
but not classic lossy JPEG, so for transfer syntaxes it cannot decode (e.g.
JPEG Extended / 12-bit lossy, common in dental CBCT) we fall back to a GDCM
decompression pass and retry. We keep the ZIP-safety guards, the subprocess
isolation and the reload-validation around it, and add rule-based series
selection driven by the BIDS JSON sidecars dcm2niix emits.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import nibabel as nib

from backend.utils.dicom_zip import populate_dir_from_zip_or_file

# The dcm2niix PyPI wheel ships the binary and exposes its path as ``bin``.
try:  # pragma: no cover - import-time wiring
    from dcm2niix import bin as _BUNDLED_DCM2NIIX_BIN
except Exception:  # wheel layout changed / not installed
    _BUNDLED_DCM2NIIX_BIN = None

# Hard ceiling so a pathological series cannot hang a worker forever.
_CONVERSION_TIMEOUT_SECONDS = 1200

# ImageType markers for series we should not pick as the diagnostic volume.
# DERIVED / SECONDARY are deliberately absent: CBCT (and many MR) reconstructions
# are routinely tagged DERIVED\SECONDARY yet are exactly the volume we want.
_NON_PRIMARY_IMAGE_TYPES = {"LOCALIZER", "SCOUT"}


def _dcm2niix_binary() -> str:
    if _BUNDLED_DCM2NIIX_BIN and Path(_BUNDLED_DCM2NIIX_BIN).exists():
        return str(_BUNDLED_DCM2NIIX_BIN)
    found = shutil.which("dcm2niix")
    if found:
        return found
    raise RuntimeError(
        "dcm2niix binary not found; install the 'dcm2niix' package or put the "
        "binary on PATH."
    )


def _run_dcm2niix(dicom_dir: Path, nifti_dir: Path) -> str:
    """Convert every series under ``dicom_dir`` into ``nifti_dir``.

    Writes one ``.nii.gz`` plus a BIDS ``.json`` sidecar per series. Returns a
    trimmed log tail for diagnostics. Does not raise on a non-zero exit code:
    dcm2niix can fail one series while succeeding on others, so the caller
    decides based on whether any volume was actually produced.
    """
    cmd = [
        _dcm2niix_binary(),
        "-z", "y",      # gzip output -> .nii.gz
        "-m", "2",      # auto-merge slices/series that belong to one volume
        "-b", "y",      # write BIDS JSON sidecars (used for series selection)
        "-o", str(nifti_dir),
        "-f", "%s_%d",  # <series number>_<series description>
        str(dicom_dir),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=_CONVERSION_TIMEOUT_SECONDS,
    )
    return (proc.stderr or proc.stdout or "").strip()


def _gdcm_decompress_dir(src_dir: Path, dst_dir: Path) -> int:
    """Rewrite every readable DICOM under ``src_dir`` into ``dst_dir`` as
    uncompressed Explicit VR Little Endian, preserving the directory layout.

    Used as a fallback for transfer syntaxes dcm2niix cannot decode. GDCM
    supports a much wider codec range (classic lossy/lossless JPEG, JPEG-LS,
    JPEG 2000, RLE). Files GDCM cannot read as images (reports, DICOMDIR, junk)
    are skipped. Returns the number of files written.
    """
    import gdcm

    # Silence GDCM's own warning stream; codec messages from the bundled
    # libjpeg still go to stderr but are non-fatal.
    gdcm.Trace.WarningOff()
    gdcm.Trace.DebugOff()
    gdcm.Trace.ErrorOff()

    written = 0
    target_ts = gdcm.TransferSyntax(gdcm.TransferSyntax.ExplicitVRLittleEndian)
    for path in sorted(src_dir.rglob("*")):
        if not path.is_file():
            continue
        reader = gdcm.ImageReader()
        reader.SetFileName(str(path))
        if not reader.Read():
            continue
        change = gdcm.ImageChangeTransferSyntax()
        change.SetTransferSyntax(target_ts)
        change.SetInput(reader.GetImage())
        if not change.Change():
            continue
        target = dst_dir / path.relative_to(src_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        writer = gdcm.ImageWriter()
        writer.SetFileName(str(target))
        writer.SetFile(reader.GetFile())
        writer.SetImage(change.GetOutput())
        if writer.Write():
            written += 1
    return written


def _collect_nifti_candidates(directory: Path) -> list[Path]:
    gz = sorted(directory.rglob("*.nii.gz"))
    plain = sorted(directory.rglob("*.nii"))
    return gz + plain


def _spatial_voxel_count(nifti_path: Path) -> int:
    """Approximate 3D volume size for choosing among multi-series exports."""
    img = nib.load(str(nifti_path))
    shape = tuple(img.shape)
    if len(shape) >= 3:
        return int(math.prod(shape[:3]))
    return int(math.prod(shape)) if shape else 0


def _sidecar_metadata(nifti_path: Path) -> dict:
    """Load the BIDS JSON sidecar dcm2niix wrote next to ``nifti_path``."""
    name = nifti_path.name
    if name.endswith(".nii.gz"):
        stem = name[:-7]
    elif name.endswith(".nii"):
        stem = name[:-4]
    else:
        stem = nifti_path.stem
    sidecar = nifti_path.with_name(stem + ".json")
    if not sidecar.is_file():
        return {}
    try:
        return json.loads(sidecar.read_text())
    except (ValueError, OSError):
        return {}


def _is_non_primary(meta: dict) -> bool:
    image_type = meta.get("ImageType") or []
    values = {str(v).upper() for v in image_type}
    return bool(values & _NON_PRIMARY_IMAGE_TYPES)


def _select_primary_nifti(candidates: list[Path]) -> Path:
    """Pick the diagnostic volume when dcm2niix wrote several series.

    Prefers non-localizer/scout series (via the BIDS sidecar ``ImageType``);
    within the preferred set, takes the spatially largest volume, breaking ties
    by filename for determinism. Falls back to all candidates when sidecars are
    missing or every series looks non-primary.
    """
    if len(candidates) == 1:
        return candidates[0]
    primary = [p for p in candidates if not _is_non_primary(_sidecar_metadata(p))]
    pool = primary or candidates
    scored = [(p, _spatial_voxel_count(p)) for p in pool]
    scored.sort(key=lambda t: (-t[1], t[0].name))
    return scored[0][0]


def convert_dicom(
    input_path: str,
    out_dir: str,
    max_zip_members: int,
    max_uncompressed_zip_bytes: int,
) -> str:
    """Convert a DICOM input to a NIfTI file.

    Accepts either a ZIP archive containing DICOM files or a single DICOM file.
    Returns the path (str) of ``converted.nii.gz`` under ``out_dir``.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    dicom_dir = out / "dicom_extracted"
    if dicom_dir.exists():
        shutil.rmtree(dicom_dir)
    dicom_dir.mkdir(parents=True, exist_ok=True)

    populate_dir_from_zip_or_file(
        Path(input_path),
        dicom_dir,
        max_members=max_zip_members,
        max_uncompressed_bytes=max_uncompressed_zip_bytes,
    )

    nifti_dir = out / "nifti_from_dicom"
    if nifti_dir.exists():
        shutil.rmtree(nifti_dir)
    nifti_dir.mkdir(parents=True, exist_ok=True)

    log_tail = _run_dcm2niix(dicom_dir, nifti_dir)
    candidates = _collect_nifti_candidates(nifti_dir)

    if not candidates:
        # dcm2niix's bundled codecs cannot decode every compressed transfer
        # syntax (e.g. JPEG Extended / 12-bit lossy in dental CBCT). Decompress
        # with GDCM and retry once before giving up.
        decompressed_dir = out / "dicom_decompressed"
        if decompressed_dir.exists():
            shutil.rmtree(decompressed_dir)
        decompressed_dir.mkdir(parents=True, exist_ok=True)
        if _gdcm_decompress_dir(dicom_dir, decompressed_dir) > 0:
            shutil.rmtree(nifti_dir)
            nifti_dir.mkdir(parents=True, exist_ok=True)
            log_tail = _run_dcm2niix(decompressed_dir, nifti_dir)
            candidates = _collect_nifti_candidates(nifti_dir)

    if not candidates:
        detail = f" dcm2niix log: {log_tail[-400:]}" if log_tail else ""
        raise RuntimeError(
            "DICOM conversion produced no NIfTI volume. dcm2niix found no "
            "stackable image series in the upload (e.g. a single slice, a "
            "localizer/scout only, or non-image DICOM objects). Upload a full "
            "volumetric series (CT/CBCT/MR with multiple slices)." + detail
        )
    primary = _select_primary_nifti(candidates)

    final_path = out / "converted.nii.gz"
    img = nib.load(str(primary))
    nib.save(img, str(final_path))

    # Reload to catch corrupted writer output early.
    _ = nib.load(str(final_path))
    return str(final_path)
