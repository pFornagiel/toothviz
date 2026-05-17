import { useState } from "react";

import { DashedFileDropZone } from "./DashedFileDropZone";
import { isNiftiFileName, NIFTI_EXTENSIONS } from "./medicalFileTypes";

interface OpenRawFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (primary: File, mask?: File) => void;
}

export function OpenRawFileModal({
  isOpen,
  onClose,
  onSubmit,
}: OpenRawFileModalProps) {
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [primaryFileError, setPrimaryFileError] = useState<string | null>(null);
  const [segmentationFile, setSegmentationFile] = useState<File | null>(null);
  const [segmentationFileError, setSegmentationFileError] = useState<
    string | null
  >(null);

  if (!isOpen) return null;

  function applyPrimaryFile(
    file: File | null,
    input?: HTMLInputElement | null,
  ): void {
    if (!file) {
      setPrimaryFile(null);
      setPrimaryFileError(null);
      if (input) input.value = "";
      return;
    }
    if (!isNiftiFileName(file.name)) {
      setPrimaryFile(null);
      setPrimaryFileError(
        `Choose a NIfTI file (${NIFTI_EXTENSIONS.join(" or ")}).`,
      );
      if (input) input.value = "";
      return;
    }
    setPrimaryFileError(null);
    setPrimaryFile(file);
  }

  function applyMaskFile(
    file: File | null,
    input?: HTMLInputElement | null,
  ): void {
    if (!file) {
      setSegmentationFile(null);
      setSegmentationFileError(null);
      if (input) input.value = "";
      return;
    }
    if (!isNiftiFileName(file.name)) {
      setSegmentationFile(null);
      setSegmentationFileError(
        `Choose a NIfTI mask (${NIFTI_EXTENSIONS.join(" or ")}).`,
      );
      if (input) input.value = "";
      return;
    }
    setSegmentationFileError(null);
    setSegmentationFile(file);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (primaryFile) {
      onSubmit(primaryFile, segmentationFile ?? undefined);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded max-w-2xl w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h2 className="text-base text-gray-200">Open Raw File</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Primary NIfTI File */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Primary NIfTI File *
            </label>

            <p className="text-xs text-gray-500">
              Allowed: {NIFTI_EXTENSIONS.join(", ")}
            </p>
            <DashedFileDropZone
              selectedFile={primaryFile}
              onFileChange={(file, input) => applyPrimaryFile(file, input)}
              emptyText="Drop a NIfTI here or click to browse"
            />
            {primaryFileError && (
              <p className="text-xs text-red-400">{primaryFileError}</p>
            )}
          </div>

          {/* Optional Segmentation Mask */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Segmentation Mask (Optional)
            </label>

            <p className="text-xs text-gray-500">
              Allowed: {NIFTI_EXTENSIONS.join(", ")}
            </p>
            <DashedFileDropZone
              selectedFile={segmentationFile}
              onFileChange={(file, input) => applyMaskFile(file, input)}
              emptyText="Drop a mask here or click to browse (optional)"
            />
            {segmentationFileError && (
              <p className="text-xs text-red-400">{segmentationFileError}</p>
            )}
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
              disabled={!primaryFile}
              className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600"
            >
              Open
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
