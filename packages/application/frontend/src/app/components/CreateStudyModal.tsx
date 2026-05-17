import { useId, useRef, useState, type DragEvent } from "react";

/** Used for hints only; `accept` is omitted because Safari/macOS greys out unknown extensions. */
const NIFTI_EXTENSIONS = [".nii", ".nii.gz"] as const;
const DICOM_BASE_EXTENSIONS = [".zip", ".dcm"] as const;

function isNiftiFileName(name: string): boolean {
  const name_lower_case = name.toLowerCase();
  return name_lower_case.endsWith(".nii") || name_lower_case.endsWith(".nii.gz");
}

function isDicomBaseFile(file: File): boolean {
  const name_lower_case = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return (
    name_lower_case.endsWith(".zip") ||
    name_lower_case.endsWith(".dcm") ||
    mime === "application/dicom" ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed"
  );
}

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

export function CreateStudyModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateStudyModalProps) {
  const baseImageInputId = useId();
  const segmentationInputId = useId();
  const precomputedRadioId = useId();
  const segmentationFileInputRef = useRef<HTMLInputElement>(null);
  const baseImageInputRef = useRef<HTMLInputElement>(null);
  const baseDropEnterCountRef = useRef(0);
  const segmentationDropEnterCountRef = useRef(0);

  const [studyName, setStudyName] = useState("");
  const [baseImageFile, setBaseImageFile] = useState<File | null>(null);
  const [baseFileError, setBaseFileError] = useState<string | null>(null);
  const [isBaseDropActive, setIsBaseDropActive] = useState(false);
  const [isSegmentationDropActive, setIsSegmentationDropActive] =
    useState(false);
  const [fileType, setFileType] = useState<"nifti" | "dicom">("nifti");
  const [segmentationType, setSegmentationType] = useState<
    "none" | "precomputed" | "automated" | "testing_stub"
  >("none");
  const [segmentationFile, setSegmentationFile] = useState<File | null>(null);
  const [segmentationFileError, setSegmentationFileError] = useState<
    string | null
  >(null);

  if (!isOpen) return null;

  function applyBaseImageFile(
    file: File | null,
    input?: HTMLInputElement | null,
  ): void {
    if (!file) {
      setBaseImageFile(null);
      setBaseFileError(null);
      if (input) input.value = "";
      return;
    }
    if (fileType === "nifti" && !isNiftiFileName(file.name)) {
      setBaseImageFile(null);
      setBaseFileError(
        `Choose a NIfTI file (${NIFTI_EXTENSIONS.join(" or ")}).`,
      );
      if (input) input.value = "";
      return;
    }
    if (fileType === "dicom" && !isDicomBaseFile(file)) {
      setBaseImageFile(null);
      setBaseFileError(
        "Choose a ZIP of a DICOM directory or a .dcm file.",
      );
      if (input) input.value = "";
      return;
    }
    setBaseFileError(null);
    setBaseImageFile(file);
  }

  function handleBaseImageFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): void {
    const input = e.target;
    applyBaseImageFile(input.files?.[0] ?? null, input);
  }

  function applySegmentationFile(
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

  function handleSegmentationFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): void {
    const input = e.target;
    applySegmentationFile(input.files?.[0] ?? null, input);
  }

  function hasFilePayload(e: DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function resetBaseDropVisualState(): void {
    baseDropEnterCountRef.current = 0;
    setIsBaseDropActive(false);
  }

  function handleBaseDragEnter(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (!hasFilePayload(e)) return;
    baseDropEnterCountRef.current += 1;
    setIsBaseDropActive(true);
  }

  function handleBaseDragLeave(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (!hasFilePayload(e)) return;
    baseDropEnterCountRef.current -= 1;
    if (baseDropEnterCountRef.current <= 0) {
      resetBaseDropVisualState();
    }
  }

  function handleBaseDragOver(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (hasFilePayload(e)) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleBaseDrop(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    e.stopPropagation();
    resetBaseDropVisualState();
    const file = e.dataTransfer.files?.[0] ?? null;
    applyBaseImageFile(file);
    if (baseImageInputRef.current) {
      baseImageInputRef.current.value = "";
    }
  }

  function resetSegmentationDropVisualState(): void {
    segmentationDropEnterCountRef.current = 0;
    setIsSegmentationDropActive(false);
  }

  function handleSegmentationDragEnter(e: DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (!hasFilePayload(e)) return;
    segmentationDropEnterCountRef.current += 1;
    setIsSegmentationDropActive(true);
  }

  function handleSegmentationDragLeave(
    e: DragEvent<HTMLButtonElement>,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    if (!hasFilePayload(e)) return;
    segmentationDropEnterCountRef.current -= 1;
    if (segmentationDropEnterCountRef.current <= 0) {
      resetSegmentationDropVisualState();
    }
  }

  function handleSegmentationDragOver(e: DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (hasFilePayload(e)) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleSegmentationDrop(e: DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    e.stopPropagation();
    resetSegmentationDropVisualState();
    const file = e.dataTransfer.files?.[0] ?? null;
    applySegmentationFile(file, segmentationFileInputRef.current);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (studyName && baseImageFile) {
      onSubmit({
        studyName,
        baseImageFile,
        fileType,
        segmentationType,
        segmentationFile:
          segmentationType === "precomputed"
            ? (segmentationFile ?? undefined)
            : undefined,
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4 sticky top-0 bg-gray-800">
          <h2 className="text-base text-gray-200">Create a Study</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Study Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Study Name *
            </label>
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
            <label className="block text-sm text-gray-400 mb-2">
              Base Medical Image *
            </label>

            {/* File Type Selection */}
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="radio"
                  name="fileType"
                  value="nifti"
                  checked={fileType === "nifti"}
                  onChange={() => {
                    setFileType("nifti");
                    setBaseImageFile(null);
                    setBaseFileError(null);
                    baseDropEnterCountRef.current = 0;
                    setIsBaseDropActive(false);
                  }}
                />
                NIfTI File
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input
                  type="radio"
                  name="fileType"
                  value="dicom"
                  checked={fileType === "dicom"}
                  onChange={() => {
                    setFileType("dicom");
                    setBaseImageFile(null);
                    setBaseFileError(null);
                    baseDropEnterCountRef.current = 0;
                    setIsBaseDropActive(false);
                  }}
                />
                DICOM Directory (ZIP)
              </label>
            </div>

            <p className="text-xs text-gray-500">
              {fileType === "nifti"
                ? `Allowed: ${NIFTI_EXTENSIONS.join(", ")}`
                : `Allowed: ${DICOM_BASE_EXTENSIONS[0]} (DICOM directory) or ${DICOM_BASE_EXTENSIONS[1]}`}
            </p>
            <label
              htmlFor={baseImageInputId}
              onDragEnter={handleBaseDragEnter}
              onDragLeave={handleBaseDragLeave}
              onDragOver={handleBaseDragOver}
              onDrop={handleBaseDrop}
              className={[
                "block cursor-pointer rounded border border-dashed px-4 py-6 text-center text-sm transition-colors duration-150 select-none",
                isBaseDropActive
                  ? "border-cyan-400 bg-cyan-950/35 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]"
                  : "border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300",
              ].join(" ")}
            >
              {baseImageFile
                ? baseImageFile.name
                : "Drop a file here or click to browse"}
            </label>
            <input
              ref={baseImageInputRef}
              key={fileType}
              id={baseImageInputId}
              type="file"
              className="sr-only"
              onChange={handleBaseImageFileChange}
            />
            {baseFileError && (
              <p className="text-xs text-red-400">{baseFileError}</p>
            )}
          </div>

          {/* Segmentation Options */}
          <div>
            <label className="block text-sm text-gray-400 mb-3">
              Segmentation Method
            </label>

            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                <input
                  type="radio"
                  name="segmentation"
                  value="none"
                  checked={segmentationType === "none"}
                  onChange={() => {
                    setSegmentationType("none");
                    setSegmentationFile(null);
                    setSegmentationFileError(null);
                    segmentationDropEnterCountRef.current = 0;
                    setIsSegmentationDropActive(false);
                  }}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm text-gray-300">None</div>
                </div>
              </label>

              <div className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                <input
                  id={precomputedRadioId}
                  type="radio"
                  name="segmentation"
                  value="precomputed"
                  checked={segmentationType === "precomputed"}
                  onChange={() => {
                    setSegmentationType("precomputed");
                    setSegmentationFileError(null);
                  }}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={precomputedRadioId}
                    className="text-sm text-gray-300 cursor-pointer"
                  >
                    Pre-computed Segmentation Mask
                  </label>

                  {segmentationType === "precomputed" && (
                    <div className="mt-2 border border-gray-700 rounded p-4 space-y-2">
                      <p className="text-xs text-gray-500">
                        Allowed: {NIFTI_EXTENSIONS.join(", ")}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          segmentationFileInputRef.current?.click()
                        }
                        onDragEnter={handleSegmentationDragEnter}
                        onDragLeave={handleSegmentationDragLeave}
                        onDragOver={handleSegmentationDragOver}
                        onDrop={handleSegmentationDrop}
                        className={[
                          "block w-full cursor-pointer rounded border border-dashed px-4 py-4 text-center text-sm transition-colors duration-150 select-none",
                          isSegmentationDropActive
                            ? "border-cyan-400 bg-cyan-950/35 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]"
                            : "border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300",
                        ].join(" ")}
                      >
                        {segmentationFile
                          ? segmentationFile.name
                          : "Drop a mask here or click to browse"}
                      </button>
                      <input
                        ref={segmentationFileInputRef}
                        id={segmentationInputId}
                        type="file"
                        className="sr-only"
                        onChange={handleSegmentationFileChange}
                      />
                      {segmentationFileError && (
                        <p className="text-xs text-red-400">
                          {segmentationFileError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <label className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                <input
                  type="radio"
                  name="segmentation"
                  value="automated"
                  checked={segmentationType === "automated"}
                  onChange={() => {
                    setSegmentationType("automated");
                    setSegmentationFile(null);
                    setSegmentationFileError(null);
                    segmentationDropEnterCountRef.current = 0;
                    setIsSegmentationDropActive(false);
                  }}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm text-gray-300">
                    Automated Deep Learning Pipeline
                  </div>
                </div>
              </label>

              {import.meta.env.DEV && (
                <label className="flex items-start gap-3 p-3 border border-gray-700 rounded cursor-pointer hover:bg-gray-750">
                  <input
                    type="radio"
                    name="segmentation"
                    value="testing_stub"
                    checked={segmentationType === "testing_stub"}
                    onChange={() => {
                      setSegmentationType("testing_stub");
                      setSegmentationFile(null);
                      setSegmentationFileError(null);
                      segmentationDropEnterCountRef.current = 0;
                      setIsSegmentationDropActive(false);
                    }}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm text-gray-300">
                      TESTING: Stub pipeline (3×2s delays + passthrough, 4
                      steps)
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
              disabled={
                !studyName ||
                !baseImageFile ||
                (segmentationType === "precomputed" && !segmentationFile)
              }
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
