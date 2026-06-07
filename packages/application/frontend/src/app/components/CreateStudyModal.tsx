import { useState } from "react";
import { CircleCheck, FileUp, FolderOpen, Layers, SquarePlus } from "lucide-react";
import { DashedFileDropZone } from "./DashedFileDropZone";
import { validateNiftiFile, validateDicomBaseFile } from "../utils/medicalFileTypes";
import { FileType, MaskInput, SegmentationType, STUDY_MODES } from "../pipeline";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";

export interface CreateStudyData {
  studyName: string;
  baseImageFile: File;
  fileType: FileType;
  segmentationType: SegmentationType;
  segmentationFile?: File;
}

interface CreateStudyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateStudyData) => void;
}

function generateDefaultStudyName(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].substring(0, 8);
  return `Scan_${date}_${time}`;
}

export function CreateStudyModal({ isOpen, onClose, onSubmit }: CreateStudyModalProps) {
  const [studyName, setStudyName] = useState(generateDefaultStudyName());
  const [baseImageFile, setBaseImageFile] = useState<File | null>(null);
  const [baseFileError, setBaseFileError] = useState<string | null>(null);
  const [fileType, setFileType] = useState<FileType>(FileType.Nifti);
  const [segmentationType, setSegmentationType] = useState<SegmentationType>(SegmentationType.None);
  const [segmentationFile, setSegmentationFile] = useState<File | null>(null);
  const [segmentationFileError, setSegmentationFileError] = useState<string | null>(null);

  const selectedMode = STUDY_MODES[segmentationType];
  const requiresMask = selectedMode.maskInput === MaskInput.Required;
  const missingMask = requiresMask && !segmentationFile;

  function applyBaseImageFile(file: File | null, input?: HTMLInputElement | null): void {
    const error =
      fileType === FileType.Nifti ? validateNiftiFile(file) : validateDicomBaseFile(file);
    if (error) {
      setBaseImageFile(null);
      setBaseFileError(error);
      if (input) {
        input.value = "";
      }
    } else {
      setBaseFileError(null);
      setBaseImageFile(file);
    }
  }

  function selectSegmentationType(type: SegmentationType): void {
    setSegmentationType(type);
    setSegmentationFileError(null);
    if (STUDY_MODES[type].maskInput !== MaskInput.Required) {
      setSegmentationFile(null);
    }
  }

  function applySegmentationFile(file: File | null, input?: HTMLInputElement | null): void {
    const error = selectedMode.validateMask?.(file) ?? null;
    if (error) {
      setSegmentationFile(null);
      setSegmentationFileError(error);
      if (input) {
        input.value = "";
      }
    } else {
      setSegmentationFileError(null);
      setSegmentationFile(file);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (studyName && baseImageFile && !missingMask) {
      onSubmit({
        studyName,
        baseImageFile,
        fileType,
        segmentationType,
        segmentationFile: requiresMask ? (segmentationFile ?? undefined) : undefined,
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-auto overflow-y-aut min-w-4xl">
        <DialogHeader>
          <DialogTitle>Load New Scan</DialogTitle>
          <DialogDescription>Initialize a new patient scan analysis workflow.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-4">
          {/* Study Name Field */}
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium uppercase tracking-wider text-foreground"
              htmlFor="studyName"
            >
              Scan Identifier
            </label>
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
            <p className="text-xs text-muted-foreground peer-focus:text-primary transition-colors">
              Use alphanumeric characters and underscores only.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Base Medical Image Section */}
            <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4 h-[380px]">
              <div className="flex items-center gap-2 mb-1">
                <FolderOpen size={20} className="text-primary" />
                <h3 className="text-sm font-medium uppercase text-foreground">Base Image Source</h3>
              </div>

              {/* Toggle */}
              <div className="flex bg-muted p-1 rounded-md mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setFileType(FileType.Nifti);
                    setBaseImageFile(null);
                    setBaseFileError(null);
                  }}
                  className={`flex-1 py-1.5 text-center text-sm transition-all rounded cursor-pointer ${fileType === FileType.Nifti ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground border border-transparent"}`}
                >
                  NIfTI File
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFileType(FileType.Dicom);
                    setBaseImageFile(null);
                    setBaseFileError(null);
                  }}
                  className={`flex-1 py-1.5 text-center text-sm transition-all rounded cursor-pointer ${fileType === FileType.Dicom ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground border border-transparent"}`}
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
                        <CircleCheck size={32} className="text-primary mb-2" />
                        <p className="text-sm text-foreground mb-1 font-medium truncate w-full px-2">
                          {file.name}
                        </p>
                        <p className="text-xs text-primary">Click to replace</p>
                      </>
                    ) : (
                      <>
                        <FileUp
                          size={32}
                          className={`transition-colors mb-2 ${isDropActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`}
                        />
                        <p className="text-sm text-foreground mb-1">Drag & Drop file here</p>
                        <p className="text-xs text-muted-foreground">
                          or click to browse (
                          {fileType === FileType.Nifti ? ".nii, .nii.gz" : ".zip, .dcm"})
                        </p>
                      </>
                    )}
                  </>
                )}
              </DashedFileDropZone>
              {baseFileError && <p className="text-xs text-destructive mt-1">{baseFileError}</p>}
            </div>

            {/* Segmentation Method Section */}
            <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4 h-[380px] overflow-y-auto">
              <div className="flex items-center gap-2 mb-1">
                <Layers size={20} className="text-primary" />
                <h3 className="text-sm font-medium uppercase text-foreground">
                  Segmentation Pipeline
                </h3>
              </div>

              <div className="flex flex-col gap-2">
                {Object.values(STUDY_MODES).map((mode) => {
                  const selected = segmentationType === mode.key;
                  const showMaskInput = selected && mode.maskInput === MaskInput.Required;
                  return (
                    <label
                      key={mode.key}
                      className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${selected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"}`}
                    >
                      <input
                        type="radio"
                        name="segMethod"
                        className="mt-0.5 w-4 h-4 text-primary focus:ring-primary border-border"
                        checked={selected}
                        onChange={() => selectSegmentationType(mode.key)}
                      />
                      <div className="flex flex-col w-full">
                        <span
                          className={`text-sm font-medium ${selected ? "text-primary" : "text-foreground"}`}
                        >
                          {mode.label}
                        </span>
                        <span
                          className={`text-xs text-muted-foreground${showMaskInput ? " mb-2" : ""}`}
                        >
                          {mode.hint}
                        </span>

                        {showMaskInput && (
                          <DashedFileDropZone
                            trigger="button"
                            selectedFile={segmentationFile}
                            onFileChange={(file, input) => applySegmentationFile(file, input)}
                            className="border border-dashed border-border rounded flex flex-col items-center justify-center p-6 text-center bg-background hover:border-primary/60 transition-colors group min-h-[6rem]"
                            activeClassName="border-primary bg-primary/10"
                            inactiveClassName=""
                          >
                            {({ isDropActive, file }) => (
                              <div className="flex flex-col items-center gap-2 w-full cursor-pointer">
                                {file ? (
                                  <CircleCheck size={24} className="text-primary" />
                                ) : (
                                  <FileUp
                                    size={24}
                                    className={isDropActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"}
                                  />
                                )}
                                <span
                                  className={`text-xs truncate w-full px-2 ${file ? "text-primary font-medium" : isDropActive ? "text-primary" : "text-muted-foreground"}`}
                                >
                                  {file ? file.name : "Click or drop mask file here"}
                                </span>
                              </div>
                            )}
                          </DashedFileDropZone>
                        )}
                        {showMaskInput && segmentationFileError && (
                          <p className="text-xs text-destructive mt-1">{segmentationFileError}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="items-center sm:justify-between mt-4">
            <span className="text-xs text-muted-foreground flex-1">
              {!studyName || !baseImageFile || missingMask
                ? "Status: Waiting for required inputs"
                : "Status: Ready"}
            </span>
            <div className="flex gap-4">
              <Button type="button" className="cursor-pointer" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="cursor-pointer" disabled={!studyName || !baseImageFile || missingMask}>
                <SquarePlus size={18} />
                Create
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
