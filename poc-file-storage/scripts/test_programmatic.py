# scripts/test_programmatic.py
import os
import numpy as np
import nibabel as nib
from storage.local import LocalPersistentStorage

# 1) init storage (creates ./data and a SQLite DB if missing)
store = LocalPersistentStorage(root="./data", sqlite_url="sqlite:///storage.sqlite3")

# 2) create a study
sid = store.create_study(external_id="CASE-TOOTH", meta={"note": "programmatic test"})
print("Study:", sid)

# 3) point on real nifti file
input_path = "test_cbct.nii.gz"
if not os.path.exists(input_path):
    print("No real NIfTI found, generating a small synthetic volume...")
    arr = (np.random.rand(64, 64, 64) * 1000).astype(np.float32)
    img = nib.Nifti1Image(arr, affine=np.eye(4))
    nib.save(img, input_path)

# 4) store the original NIfTI (role=original, kind=nifti)
orig = store.store_from_local_path(
    study_id=sid, role="original", kind="nifti",
    src_path=input_path, filename="input.nii.gz", content_type="application/gzip"
)
print("Original stored:", orig)

# 5) simulate a segmentation: threshold the original and save mask
img = nib.load(input_path)
arr = img.get_fdata()
mask = (arr > np.percentile(arr, 75)).astype(np.uint8)
mask_img = nib.Nifti1Image(mask, affine=img.affine)
mask_path = "seg_model_v1.nii.gz"
nib.save(mask_img, mask_path)

# 6) store the mask as a derived artifact
seg = store.store_from_local_path(
    study_id=sid, role="derived", kind="segmentation",
    src_path=mask_path, filename="seg_model-v1.nii.gz",
    content_type="application/gzip", meta={"model": "demo_threshold"}
)
print("Segmentation stored:", seg)

# 7) list files and read a few bytes back
derived = store.list_files(sid, role="derived", kind="segmentation")
print("Derived files:", derived)

with store.open_file(seg.id) as f:
    print("First 16 bytes of seg file:", f.read(16))

store.dispose()
print("Done. Inspect ./data/ on disk.")