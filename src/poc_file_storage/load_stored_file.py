import glob, nibabel as nib
p = glob.glob("data/studies/*/raw/input.nii.gz")[0]
img = nib.load(p)
print("Loaded:", p, "shape:", img.shape, "zooms:", img.header.get_zooms())