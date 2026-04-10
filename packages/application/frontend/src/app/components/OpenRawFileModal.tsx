import { useState } from "react";

interface OpenRawFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (primary: File, mask?: File) => void;
}

export function OpenRawFileModal({ isOpen, onClose, onSubmit }: OpenRawFileModalProps) {
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [segmentationFile, setSegmentationFile] = useState<File | null>(null);

  if (!isOpen) return null;

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
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Primary NIfTI File */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Primary NIfTI File *</label>
            <div className="border border-gray-700 rounded p-6">
              <input
                type="file"
                accept=".nii,.nii.gz"
                onChange={(e) => setPrimaryFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-400"
              />
              {primaryFile && <p className="text-xs text-gray-500 mt-2">{primaryFile.name}</p>}
            </div>
          </div>

          {/* Optional Segmentation Mask */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Segmentation Mask (Optional)</label>
            <div className="border border-gray-700 rounded p-6">
              <input
                type="file"
                accept=".nii,.nii.gz"
                onChange={(e) => setSegmentationFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-400"
              />
              {segmentationFile && <p className="text-xs text-gray-500 mt-2">{segmentationFile.name}</p>}
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