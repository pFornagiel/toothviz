import { useId, useState } from "react";
import { DashedFileDropZone } from "./DashedFileDropZone";
import { validateNiftiFile, validateDicomBaseFile } from "../utils/medicalFileTypes";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";

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

function generateDefaultStudyName(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; 
  const time = now.toTimeString().split(' ')[0].substring(0, 8);
  return `visualization_${date}_${time}`
}

export function CreateStudyModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateStudyModalProps) {
  const precomputedRadioId = useId();

  const [studyName, setStudyName] = useState(generateDefaultStudyName());
  const [baseImageFile, setBaseImageFile] = useState<File | null>(null);
  const [baseFileError, setBaseFileError] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"nifti" | "dicom">("nifti");
  const [segmentationType, setSegmentationType] = useState<
    "none" | "precomputed" | "automated" | "testing_stub"
  >("none");
  const [segmentationFile, setSegmentationFile] = useState<File | null>(null);
  const [segmentationFileError, setSegmentationFileError] = useState<string | null>(null);

  function applyBaseImageFile(file: File | null, input?: HTMLInputElement | null): void {
    const error = fileType === "nifti" ? validateNiftiFile(file) : validateDicomBaseFile(file);
    if (error) {
      setBaseImageFile(null);
      setBaseFileError(error);
      if (input) input.value = "";
    } else {
      setBaseFileError(null);
      setBaseImageFile(file);
    }
  }

  function applySegmentationFile(file: File | null, input?: HTMLInputElement | null): void {
    const error = validateNiftiFile(file);
    if (error) {
      setSegmentationFile(null);
      setSegmentationFileError(error);
      if (input) input.value = "";
    } else {
      setSegmentationFileError(null);
      setSegmentationFile(file);
    }
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-auto overflow-y-aut min-w-4xl">
        <DialogHeader>
          <DialogTitle>Create New Study</DialogTitle>
          <DialogDescription>
            Initialize a new patient scan analysis workflow.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-4">
          {/* Study Name Field */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium uppercase tracking-wider text-foreground" htmlFor="studyName">Study Identifier</label>
            <div className="relative">
              <input 
                id="studyName" 
                type="text" 
                value={studyName}
                onChange={(e) => setStudyName(e.target.value)}
                required
                placeholder="e.g., Patient_Scan_2023_Axial" 
                className="w-full px-4 py-2 bg-background border border-border rounded text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all peer placeholder:text-muted-foreground" 
              />
            </div>
            <p className="text-xs text-muted-foreground peer-focus:text-primary transition-colors">Use alphanumeric characters and underscores only.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Base Medical Image Section */}
            <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4 h-[380px]">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-primary text-[20px]" style={{fontVariationSettings: "'FILL' 1"}}>folder_open</span>
                <h3 className="text-sm font-medium uppercase text-foreground">Base Image Source</h3>
              </div>

              {/* Toggle */}
              <div className="flex bg-muted p-1 rounded-md mb-2">
                <button 
                  type="button"
                  onClick={() => {
                    setFileType("nifti");
                    setBaseImageFile(null);
                    setBaseFileError(null);
                  }}
                  className={`flex-1 py-1.5 text-center text-sm transition-all rounded ${fileType === "nifti" ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground border border-transparent"}`}
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
                  className={`flex-1 py-1.5 text-center text-sm transition-all rounded ${fileType === "dicom" ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground border border-transparent"}`}
                >
                  DICOM Dir
                </button>
              </div>

              <DashedFileDropZone
                key={fileType}
                selectedFile={baseImageFile}
                onFileChange={(file, input) => applyBaseImageFile(file, input)}
                className="border-2 border-dashed border-border transition-colors rounded-lg flex flex-col items-center justify-center p-6 text-center cursor-pointer group flex-1 bg-card hover:bg-accent"
                activeClassName="border-primary bg-primary/10"
                inactiveClassName=""
              >
                {({ isDropActive, file }) => (
                  <>
                    {file ? (
                      <>
                        <span className="material-symbols-outlined text-[32px] text-primary mb-2">check_circle</span>
                        <p className="text-sm text-foreground mb-1 font-medium truncate w-full px-2">{file.name}</p>
                        <p className="text-xs text-primary">Click to replace</p>
                      </>
                    ) : (
                      <>
                        <span className={`material-symbols-outlined text-[32px] transition-colors mb-2 ${isDropActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`}>upload_file</span>
                        <p className="text-sm text-foreground mb-1">Drag & Drop file here</p>
                        <p className="text-xs text-muted-foreground">
                          or click to browse ({fileType === "nifti" ? ".nii, .nii.gz" : ".zip, .dcm"})
                        </p>
                      </>
                    )}
                  </>
                )}
              </DashedFileDropZone>
              {baseFileError && (
                <p className="text-xs text-destructive mt-1">{baseFileError}</p>
              )}
            </div>

            {/* Segmentation Method Section */}
            <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4 h-[380px] overflow-y-auto">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-primary text-[20px]" style={{fontVariationSettings: "'FILL' 1"}}>layers</span>
                <h3 className="text-sm font-medium uppercase text-foreground">Segmentation Pipeline</h3>
              </div>

              <div className="flex flex-col gap-2">
                {/* Option 1: None */}
                <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "none" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}>
                  <input 
                    type="radio" 
                    name="segMethod" 
                    className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-border"
                    checked={segmentationType === "none"}
                    onChange={() => {
                      setSegmentationType("none");
                      setSegmentationFile(null);
                      setSegmentationFileError(null);
                    }}
                  />
                  <div className="flex flex-col">
                    <span className={`text-sm font-medium ${segmentationType === "none" ? "text-primary" : "text-foreground"}`}>None</span>
                    <span className="text-xs text-muted-foreground">Raw visualization only</span>
                  </div>
                </label>

                {/* Option 2: Pre-computed */}
                <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "precomputed" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}>
                  <input 
                    id={precomputedRadioId}
                    type="radio" 
                    name="segMethod" 
                    className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-border"
                    checked={segmentationType === "precomputed"}
                    onChange={() => {
                      setSegmentationType("precomputed");
                      setSegmentationFileError(null);
                    }}
                  />
                  <div className="flex flex-col w-full">
                    <span className={`text-sm font-medium ${segmentationType === "precomputed" ? "text-primary" : "text-foreground"}`}>Pre-computed Mask</span>
                    <span className="text-xs text-muted-foreground mb-2">Upload existing .nii.gz mask</span>
                    
                    {segmentationType === "precomputed" && (
                      <DashedFileDropZone
                        trigger="button"
                        selectedFile={segmentationFile}
                        onFileChange={(file, input) => applySegmentationFile(file, input)}
                        className="border border-dashed border-border rounded flex flex-col items-center justify-center p-6 text-center bg-background hover:border-primary/60 transition-colors group min-h-[6rem]"
                        activeClassName="border-primary bg-primary/10"
                        inactiveClassName=""
                      >
                        {({ isDropActive, file }) => (
                          <div className="flex flex-col items-center gap-2 w-full">
                            <span className={`material-symbols-outlined text-[24px] ${file ? 'text-primary' : isDropActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`}>
                              {file ? 'check_circle' : 'upload_file'}
                            </span>
                            <span className={`text-xs truncate w-full px-2 ${file ? 'text-primary font-medium' : isDropActive ? 'text-primary' : 'text-muted-foreground'}`}>
                              {file ? file.name : "Click or drop mask file here"}
                            </span>
                          </div>
                        )}
                      </DashedFileDropZone>
                    )}
                    {segmentationFileError && segmentationType === "precomputed" && (
                      <p className="text-xs text-destructive mt-1">{segmentationFileError}</p>
                    )}
                  </div>
                </label>

                {/* Option 3: Automated */}
                <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "automated" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}>
                  <input 
                    type="radio" 
                    name="segMethod" 
                    className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-border"
                    checked={segmentationType === "automated"}
                    onChange={() => {
                      setSegmentationType("automated");
                      setSegmentationFile(null);
                      setSegmentationFileError(null);
                    }}
                  />
                  <div className="flex flex-col">
                    <span className={`text-sm font-medium ${segmentationType === "automated" ? "text-primary" : "text-foreground"}`}>Automated Deep Learning</span>
                    <span className="text-xs text-muted-foreground">Run inference via connected cluster</span>
                  </div>
                </label>

                {/* Option 4: Testing Stub */}
                {import.meta.env.DEV && (
                  <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${segmentationType === "testing_stub" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}>
                    <input 
                      type="radio" 
                      name="segMethod" 
                      className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-border"
                      checked={segmentationType === "testing_stub"}
                      onChange={() => {
                        setSegmentationType("testing_stub");
                        setSegmentationFile(null);
                        setSegmentationFileError(null);
                      }}
                    />
                    <div className="flex flex-col">
                      <span className={`text-sm font-medium ${segmentationType === "testing_stub" ? "text-primary" : "text-foreground"}`}>TESTING: Stub pipeline</span>
                      <span className="text-xs text-muted-foreground">3×2s delays + passthrough, 4 steps</span>
                    </div>
                  </label>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="items-center sm:justify-between mt-4">
            <span className="text-xs text-muted-foreground flex-1">
              {(!studyName || !baseImageFile || (segmentationType === "precomputed" && !segmentationFile)) 
                ? "Status: Waiting for required inputs" 
                : "Status: Ready"}
            </span>
            <div className="flex gap-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={!studyName || !baseImageFile || (segmentationType === "precomputed" && !segmentationFile)}
              >
                <span className="material-symbols-outlined text-[18px]">add_box</span>
                Create
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
