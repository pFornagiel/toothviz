import { useState } from "react";

export interface CreateStudyData {
  studyName: string;
  baseImageFile: File;
  fileType: "nifti" | "dicom";
  segmentationType: "none" | "precomputed" | "automated" | "testing_stub";
  segmentationFile?: File;
}

interface CreateStudyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateStudyData) => void;
}

export function CreateStudyModal({ isOpen, onClose, onSubmit }: CreateStudyModalProps) {
  const [studyName, setStudyName] = useState("");
  const [baseImageFile, setBaseImageFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<"nifti" | "dicom">("nifti");
  const [segmentationType, setSegmentationType] = useState<"none" | "precomputed" | "automated" | "testing_stub">("none");
  const [segmentationFile, setSegmentationFile] = useState<File | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (studyName && baseImageFile) {
      onSubmit({
        studyName,
        baseImageFile,
        fileType,
        segmentationType,
        segmentationFile: segmentationType === "precomputed" ? segmentationFile ?? undefined : undefined,
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4 sticky top-0 bg-gray-800">
          <h2 className="text-base text-gray-200">Create a Study</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Study Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Study Name *</label>
            <input
              type="text"
              value={studyName}
              onChange={(e) => setStudyName(e.target.value)}
              placeholder="Enter study name"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded text-gray-200"
              required
            />
          </div>

          {/* Base Medical Image */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Base Medical Image *</label>
            
            {/* File Type Selection */}
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="radio"
                  name="fileType"
                  value="nifti"
                  checked={fileType === "nifti"}
                  onChange={() => setFileType("nifti")}
                />
                NIfTI File
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="radio"
                  name="fileType"
                  value="dicom"
                  checked={fileType === "dicom"}
                  onChange={() => setFileType("dicom")}
                />
                DICOM Directory (ZIP)
              </label>
            </div>

            <div className="border border-gray-700 rounded p-6">
              <input
                type="file"
                accept={fileType === "nifti" ? ".nii,.nii.gz" : ".zip"}
                onChange={(e) => setBaseImageFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-400"
              />
              {baseImageFile && <p className="text-xs text-gray-500 mt-2">{baseImageFile.name}</p>}
            </div>
          </div>

          {/* Segmentation Options */}
          <div>
            <label className="block text-sm text-gray-400 mb-3">Segmentation Method</label>
            
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                <input
                  type="radio"
                  name="segmentation"
                  value="none"
                  checked={segmentationType === "none"}
                  onChange={() => setSegmentationType("none")}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm text-gray-300">None</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                <input
                  type="radio"
                  name="segmentation"
                  value="precomputed"
                  checked={segmentationType === "precomputed"}
                  onChange={() => setSegmentationType("precomputed")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm text-gray-300">Pre-computed Segmentation Mask</div>
                  
                  {segmentationType === "precomputed" && (
                    <div className="mt-2 border border-gray-700 rounded p-4">
                      <input
                        type="file"
                        accept=".nii,.nii.gz"
                        onChange={(e) => setSegmentationFile(e.target.files?.[0] || null)}
                        className="w-full text-sm text-gray-400"
                      />
                      {segmentationFile && <p className="text-xs text-gray-500 mt-2">{segmentationFile.name}</p>}
                    </div>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                <input
                  type="radio"
                  name="segmentation"
                  value="automated"
                  checked={segmentationType === "automated"}
                  onChange={() => setSegmentationType("automated")}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm text-gray-300">Automated Deep Learning Pipeline</div>
                </div>
              </label>

              {import.meta.env.DEV && (
                <label className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                  <input
                    type="radio"
                    name="segmentation"
                    value="testing_stub"
                    checked={segmentationType === "testing_stub"}
                    onChange={() => setSegmentationType("testing_stub")}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm text-gray-300">
                      TESTING: Stub pipeline (3×2s delays + passthrough, 4 steps)
                    </div>
                  </div>
                </label>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-700 rounded text-gray-400 hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!studyName || !baseImageFile || (segmentationType === "precomputed" && !segmentationFile)}
              className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}