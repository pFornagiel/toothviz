"""Ten test istnieje bo chciałem dostać output i zobaczyć czy dostajemy cokolwiek sensownego. 
Poza tym zastosowaniem jest troszke bez sensu."""
# a że jest czasochlonny i CPUżerny to go zakomentuje :) 
# import numpy as np
# import nibabel as nib
# from pathlib import Path
# import logging
# import shutil

# from poc_ml_worker.engine import predict, create_mask_file, run_inference
# from poc_ml_worker.model_loader import load_onnx_model
# from core.config import DATA_DIR, MODEL_PATH

# logger = logging.getLogger(__name__)

# def test_inference_e2e_workflow():
#     print(f"\n=== ML Inference E2E Test (Native Resolution) ===")
    
#     if not MODEL_PATH.exists():
#         print(f"⚠️ Model not found at {MODEL_PATH}, skipping")
#         return

#     input_files = list(DATA_DIR.glob("*.nii.gz"))
#     input_files = [f for f in input_files if "segmentation" not in f.name and "temp" not in f.name]
    
#     if not input_files:
#         print(f"⚠️ No .nii.gz input files found in {DATA_DIR}")
#         return
    
#     input_path = input_files[0]
#     print(f"1. Using input: {input_path.name}")

#     ml_model = load_onnx_model(str(MODEL_PATH))
#     print(f"2. Model loaded successfully")

#     print(f"\n3. Loading NIfTI image...")
#     input_img = nib.load(str(input_path))
#     canonical_img = nib.as_closest_canonical(input_img)
#     input_data = canonical_img.get_fdata()
    
#     original_shape = input_data.shape
#     print(f"   Shape: {original_shape}")
#     print(f"   Dtype: {input_data.dtype}")

#     try:
#         print(f"\n4. Running inference on native resolution...")
#         output_filename = f"segmentation_{Path(input_path.stem).stem}.nii.gz"

#         with run_inference(str(input_path), ml_model) as inference_output:
#             output_path = DATA_DIR / output_filename
#             shutil.copy(inference_output, str(output_path))
#             print(f"   ✓ Inference completed")
#             print(f"   ✓ Output saved: {output_path.name}")

#         print(f"\n5. Verifying output integrity...")
#         assert output_path.exists()
        
#         output_img = nib.load(str(output_path))
#         output_data = output_img.get_fdata()
        
#         print(f"   Output Shape: {output_data.shape}")
#         assert output_data.shape == original_shape, "Shape mismatch between input and output!"
        
#         unique_values = np.unique(output_data)
#         print(f"   Unique values: {unique_values}")
#         assert np.all((output_data == 0) | (output_data == 1))
        
#         one_ratio = (output_data == 1).sum() / output_data.size
#         print(f"   Tooth voxel ratio: {one_ratio*100:.2f}%")
#         assert one_ratio > 0, "Model predicted only background (zeros)!"

#         print(f"\n✅ E2E test successful - Native resolution maintained.")

#     finally:
#         pass