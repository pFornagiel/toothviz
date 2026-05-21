import { useId, useState } from "react";

import { DashedFileDropZone } from "./DashedFileDropZone";
import {
  DICOM_BASE_EXTENSIONS,
  isDicomBaseFile,
  isNiftiFileName,
  NIFTI_EXTENSIONS,
} from "./medicalFileTypes";

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
  const precomputedRadioId = useId();

  const [studyName, setStudyName] = useState("");
  const [baseImageFile, setBaseImageFile] = useState<File | null>(null);
  const [baseFileError, setBaseFileError] = useState<string | null>(null);
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
    <div className="fixed inset-0 bg-obsidian-text/20 p-4 flex items-center justify-center z-50 overflow-hidden">
      {/* Background decorative element for depth */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary-fixed-dim/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-background to-transparent"></div>
      </div>

      {/* Create Study Modal (Bento/Card Style) */}
      <div className="bg-[rgba(249,249,255,0.95)] backdrop-blur-md border border-outline-variant/50 w-full max-w-3xl rounded-xl shadow-[0_8px_32px_rgba(0,49,100,0.1)] flex flex-col max-h-full relative overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-outline-variant/50 flex justify-between items-center bg-surface-container-lowest/50 sticky top-0 z-10">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary">Create New Study</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">Initialize a new patient scan analysis workflow.</p>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-error transition-colors p-1 rounded-full hover:bg-surface-variant"
          >
            <span className="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 flex flex-col">
          <div className="px-6 py-6 flex flex-col gap-8 flex-1">
            {/* Study Name Field */}
            <div className="flex flex-col gap-2">
              <label className="font-label-sm text-label-sm text-primary uppercase tracking-wider" htmlFor="studyName">Study Identifier</label>
              <div className="relative">
                <input 
                  id="studyName" 
                  type="text" 
                  value={studyName}
                  onChange={(e) => setStudyName(e.target.value)}
                  required
                  placeholder="e.g., Patient_Scan_2023_Axial" 
                  className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded text-body-lg font-body-lg text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all peer placeholder-outline" 
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary opacity-0 peer-focus:opacity-100 transition-opacity">
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </span>
              </div>
              <p className="font-mono-sm text-mono-sm text-on-surface-variant peer-focus:text-primary transition-colors h-4">Use alphanumeric characters and underscores only.</p>
            </div>

            {/* Bento Grid Layout for Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Base Medical Image Section */}
              <div className="bg-surface-container-low border border-outline-variant rounded-lg p-5 flex flex-col gap-4 h-full">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-primary text-[20px]" style={{fontVariationSettings: "'FILL' 1"}}>folder_open</span>
                  <h3 className="font-label-sm text-label-sm text-primary uppercase">Base Image Source</h3>
                </div>

                {/* Toggle */}
                <div className="flex bg-surface-variant p-1 rounded-md mb-2">
                  <button 
                    type="button"
                    onClick={() => {
                      setFileType("nifti");
                      setBaseImageFile(null);
                      setBaseFileError(null);
                    }}
                    className={`flex-1 py-1.5 text-center font-label-sm text-label-sm transition-all rounded ${fileType === "nifti" ? "bg-surface-container-lowest text-primary shadow-sm border border-outline-variant/50" : "text-on-surface-variant hover:text-primary border border-transparent"}`}
                  >
                    NIfTI File
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setFileType("dicom");
                      setBaseImageFile(null);
                      setBaseFileError(null);
                    }}
                    className={`flex-1 py-1.5 text-center font-label-sm text-label-sm transition-all rounded ${fileType === "dicom" ? "bg-surface-container-lowest text-primary shadow-sm border border-outline-variant/50" : "text-on-surface-variant hover:text-primary border border-transparent"}`}
                  >
                    DICOM Dir
                  </button>
                </div>

                {/* Dropzone */}
                <DashedFileDropZone
                  key={fileType}
                  selectedFile={baseImageFile}
                  onFileChange={(file, input) => applyBaseImageFile(file, input)}
                  className="border-2 border-dashed border-outline-variant transition-colors rounded-lg flex flex-col items-center justify-center p-6 text-center cursor-pointer group flex-1"
                  activeClassName="border-primary bg-primary-fixed/20"
                  inactiveClassName="hover:border-primary/60 hover:bg-primary-fixed/10"
                >
                  {({ isDropActive, file }) => (
                    <>
                      {file ? (
                        <>
                          <span className="material-symbols-outlined text-[32px] text-primary mb-2">check_circle</span>
                          <p className="font-body-md text-body-md text-on-surface mb-1 font-medium truncate w-full px-2">{file.name}</p>
                          <p className="font-label-sm text-label-sm text-primary">Click to replace</p>
                        </>
                      ) : (
                        <>
                          <span className={`material-symbols-outlined text-[32px] transition-colors mb-2 ${isDropActive ? 'text-primary' : 'text-tertiary-fixed-dim group-hover:text-primary'}`}>upload_file</span>
                          <p className="font-body-md text-body-md text-on-surface mb-1">Drag & Drop file here</p>
                          <p className="font-label-sm text-label-sm text-on-surface-variant">
                            or click to browse ({fileType === "nifti" ? ".nii, .nii.gz" : ".zip, .dcm"})
                          </p>
                        </>
                      )}
                    </>
                  )}
                </DashedFileDropZone>
                {baseFileError && (
                  <p className="font-label-sm text-label-sm text-error mt-1">{baseFileError}</p>
                )}
              </div>

              {/* Segmentation Method Section */}
              <div className="bg-surface-container-low border border-outline-variant rounded-lg p-5 flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-primary text-[20px]" style={{fontVariationSettings: "'FILL' 1"}}>layers</span>
                  <h3 className="font-label-sm text-label-sm text-primary uppercase">Segmentation Pipeline</h3>
                </div>

                <div className="flex flex-col gap-stack-tight">
                  {/* Option 1: None */}
                  <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "none" ? "border-primary bg-primary-fixed/10" : "border-outline-variant bg-surface-container-lowest hover:border-primary/50"}`}>
                    <input 
                      type="radio" 
                      name="segMethod" 
                      className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-outline"
                      checked={segmentationType === "none"}
                      onChange={() => {
                        setSegmentationType("none");
                        setSegmentationFile(null);
                        setSegmentationFileError(null);
                      }}
                    />
                    <div className="flex flex-col">
                      <span className={`font-body-md text-body-md font-medium ${segmentationType === "none" ? "text-primary" : "text-on-surface"}`}>None</span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant">Raw visualization only</span>
                    </div>
                  </label>

                  {/* Option 2: Pre-computed */}
                  <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "precomputed" ? "border-primary bg-primary-fixed/10" : "border-outline-variant bg-surface-container-lowest hover:border-primary/50"}`}>
                    <input 
                      id={precomputedRadioId}
                      type="radio" 
                      name="segMethod" 
                      className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-outline"
                      checked={segmentationType === "precomputed"}
                      onChange={() => {
                        setSegmentationType("precomputed");
                        setSegmentationFileError(null);
                      }}
                    />
                    <div className="flex flex-col w-full">
                      <span className={`font-body-md text-body-md font-medium ${segmentationType === "precomputed" ? "text-primary" : "text-on-surface"}`}>Pre-computed Mask</span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant mb-2">Upload existing .nii.gz mask</span>
                      
                      {segmentationType === "precomputed" && (
                        <DashedFileDropZone
                          trigger="button"
                          selectedFile={segmentationFile}
                          onFileChange={(file, input) => applySegmentationFile(file, input)}
                          className="border border-dashed border-outline-variant rounded flex flex-col items-center justify-center p-6 text-center bg-surface-container-lowest hover:border-primary/60 transition-colors group min-h-[6rem]"
                          activeClassName="border-primary bg-primary-fixed/20"
                          inactiveClassName=""
                        >
                          {({ isDropActive, file }) => (
                            <div className="flex flex-col items-center gap-2 w-full">
                              <span className={`material-symbols-outlined text-[24px] ${file ? 'text-primary' : isDropActive ? 'text-primary' : 'text-on-surface-variant group-hover:text-primary'}`}>
                                {file ? 'check_circle' : 'upload_file'}
                              </span>
                              <span className={`font-label-sm text-label-sm truncate w-full px-2 ${file ? 'text-primary font-medium' : isDropActive ? 'text-primary' : 'text-on-surface-variant'}`}>
                                {file ? file.name : "Click or drop mask file here"}
                              </span>
                            </div>
                          )}
                        </DashedFileDropZone>
                      )}
                      
                      {segmentationFileError && segmentationType === "precomputed" && (
                        <p className="font-label-sm text-label-sm text-error mt-1">{segmentationFileError}</p>
                      )}
                    </div>
                  </label>

                  {/* Option 3: Automated */}
                  <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "automated" ? "border-primary bg-primary-fixed/10" : "border-outline-variant bg-surface-container-lowest hover:border-primary/50"}`}>
                    <input 
                      type="radio" 
                      name="segMethod" 
                      className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-outline"
                      checked={segmentationType === "automated"}
                      onChange={() => {
                        setSegmentationType("automated");
                        setSegmentationFile(null);
                        setSegmentationFileError(null);
                      }}
                    />
                    <div className="flex flex-col">
                      <span className={`font-body-md text-body-md font-medium ${segmentationType === "automated" ? "text-primary" : "text-on-surface"}`}>Automated Deep Learning</span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant">Run inference via connected cluster</span>
                    </div>
                  </label>

                  {/* Option 4: Testing Stub */}
                  {import.meta.env.DEV && (
                    <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "testing_stub" ? "border-primary bg-primary-fixed/10" : "border-outline-variant bg-surface-container-lowest hover:border-primary/50"}`}>
                      <input 
                        type="radio" 
                        name="segMethod" 
                        className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-outline"
                        checked={segmentationType === "testing_stub"}
                        onChange={() => {
                          setSegmentationType("testing_stub");
                          setSegmentationFile(null);
                          setSegmentationFileError(null);
                        }}
                      />
                      <div className="flex flex-col">
                        <span className={`font-body-md text-body-md font-medium ${segmentationType === "testing_stub" ? "text-primary" : "text-on-surface"}`}>TESTING: Stub pipeline</span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">3×2s delays + passthrough, 4 steps</span>
                      </div>
                    </label>
                  )}

                </div>
              </div>

            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-4 border-t border-outline-variant/50 bg-surface-container-lowest/50 flex justify-end gap-4 items-center mt-auto sticky bottom-0 z-10">
            <span className="font-mono-sm text-mono-sm text-on-surface-variant flex-1">
              {(!studyName || !baseImageFile || (segmentationType === "precomputed" && !segmentationFile)) 
                ? "Status: Waiting for required inputs" 
                : "Status: Ready"}
            </span>
            <button 
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-body-md text-body-md text-on-surface-variant border border-outline-variant rounded hover:bg-surface-variant transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={!studyName || !baseImageFile || (segmentationType === "precomputed" && !segmentationFile)}
              className="px-6 py-2 font-body-md text-body-md bg-primary text-on-primary rounded hover:bg-primary-container transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">add_box</span>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
