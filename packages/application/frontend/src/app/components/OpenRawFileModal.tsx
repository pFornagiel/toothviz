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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/30 backdrop-blur-[2px] p-4">
      {/* Modal Dialog Container */}
      <div className="bg-surface-container-lowest rounded-xl w-full max-w-[640px] flex flex-col shadow-[0_20px_40px_rgba(0,94,184,0.1)] animate-fade-in-up border border-outline-variant">
        
        {/* Modal Header */}
        <div className="flex justify-between items-center px-6 py-5 border-b border-surface-variant">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-[20px]">folder_open</span>
            </div>
            <h2 className="font-headline-md text-headline-md text-obsidian-text m-0">Open Raw File</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-on-surface-variant hover:text-primary transition-colors p-1 rounded hover:bg-surface-variant flex items-center justify-center"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="p-6 flex flex-col gap-6">
            
            {/* Primary NIfTI Input */}
            <div>
              <label className="font-label-sm text-label-sm text-obsidian-text mb-2 flex items-center gap-1 uppercase tracking-wide">
                Primary NIfTI File <span className="text-error">*</span>
              </label>

              <DashedFileDropZone
                selectedFile={primaryFile}
                onFileChange={(file, input) => applyPrimaryFile(file, input)}
                className="border border-dashed rounded-lg bg-surface flex flex-col items-center justify-center p-8 cursor-pointer transition-colors group relative overflow-hidden"
                activeClassName="border-primary bg-primary-fixed/20"
                inactiveClassName="border-primary hover:bg-primary-fixed/20"
              >
                {({ isDropActive, file }) => (
                  <>
                    {file ? (
                      <>
                        <div className="h-12 w-12 rounded-full bg-primary-fixed flex items-center justify-center mb-3">
                          <span className="material-symbols-outlined text-primary text-[24px]">check_circle</span>
                        </div>
                        <p className="font-body-md text-body-md text-obsidian-text font-medium mb-1 truncate w-full text-center px-4">{file.name}</p>
                        <p className="font-label-sm text-label-sm text-primary">Click to replace</p>
                      </>
                    ) : (
                      <>
                        <div className="h-12 w-12 rounded-full bg-primary-fixed flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                          <span className="material-symbols-outlined text-primary text-[24px]">upload_file</span>
                        </div>
                        <p className="font-body-md text-body-md text-obsidian-text font-medium mb-1">Click to browse or drag file here</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant">Supported formats: .nii, .nii.gz</p>
                      </>
                    )}
                  </>
                )}
              </DashedFileDropZone>
              {primaryFileError && (
                <p className="font-label-sm text-label-sm text-error mt-2">{primaryFileError}</p>
              )}
            </div>

            {/* Segmentation Mask Input */}
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant mb-2 flex items-center gap-1 uppercase tracking-wide">
                Segmentation Mask <span className="font-normal normal-case opacity-75">(Optional)</span>
              </label>

              <DashedFileDropZone
                selectedFile={segmentationFile}
                onFileChange={(file, input) => applyMaskFile(file, input)}
                className="border border-dashed rounded-lg bg-surface flex flex-col items-center justify-center p-6 cursor-pointer transition-colors group relative overflow-hidden"
                activeClassName="border-primary bg-primary-fixed/20"
                inactiveClassName="border-outline-variant hover:border-primary hover:bg-primary-fixed/10"
              >
                {({ isDropActive, file }) => (
                  <div className="flex items-center gap-3">
                    <span className={`material-symbols-outlined transition-colors text-[28px] ${file ? 'text-primary' : isDropActive ? 'text-primary' : 'text-outline group-hover:text-primary'}`}>
                      {file ? 'check_circle' : 'data_object'}
                    </span>
                    <div className="text-left">
                      <p className={`font-body-md text-body-md transition-colors truncate max-w-[400px] ${file ? 'text-primary' : isDropActive ? 'text-primary' : 'text-obsidian-text group-hover:text-primary'}`}>
                        {file ? file.name : "Add matching mask file"}
                      </p>
                      <p className="font-label-sm text-label-sm text-outline">
                        {file ? "Click to replace" : "Drop an overlay NIfTI file"}
                      </p>
                    </div>
                  </div>
                )}
              </DashedFileDropZone>
              {segmentationFileError && (
                <p className="font-label-sm text-label-sm text-error mt-2">{segmentationFileError}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 border-t border-surface-variant bg-surface flex justify-end gap-3 rounded-b-xl">
            <button
              type="button"
              onClick={onClose}
              className="bg-transparent border border-outline-variant text-obsidian-text font-body-md text-body-md py-2 px-6 rounded transition-colors hover:bg-surface-variant hover:border-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!primaryFile}
              className="bg-primary text-on-primary font-body-md text-body-md py-2 px-8 rounded transition-colors hover:bg-primary-container disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Open File
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
