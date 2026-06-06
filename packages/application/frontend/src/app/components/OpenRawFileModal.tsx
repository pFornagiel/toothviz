import { useState } from "react";
import { Braces, CircleCheck, FileUp } from "lucide-react";
import { DashedFileDropZone } from "./DashedFileDropZone";
import { validateNiftiFile } from "../utils/medicalFileTypes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";

interface OpenRawFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (primary: File, mask?: File) => void;
}

export function OpenRawFileModal({ isOpen, onClose, onSubmit }: OpenRawFileModalProps) {
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [primaryFileError, setPrimaryFileError] = useState<string | null>(null);
  const [segmentationFile, setSegmentationFile] = useState<File | null>(null);
  const [segmentationFileError, setSegmentationFileError] = useState<string | null>(null);

  function applyPrimaryFile(file: File | null, input?: HTMLInputElement | null): void {
    const error = validateNiftiFile(file);
    if (error) {
      setPrimaryFile(null);
      setPrimaryFileError(error);
      if (input) {
        input.value = "";
      }
    } else {
      setPrimaryFileError(null);
      setPrimaryFile(file);
    }
  }

  function applyMaskFile(file: File | null, input?: HTMLInputElement | null): void {
    const error = validateNiftiFile(file);
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
    if (primaryFile) {
      onSubmit(primaryFile, segmentationFile ?? undefined);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="min-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>Open Raw File</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Open a NIfTI file and an optional segmentation mask for volatile visualization.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6 pt-4">
          {/* Primary NIfTI Input */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1 uppercase tracking-wide">
              Primary NIfTI File <span className="text-destructive">*</span>
            </label>

            <DashedFileDropZone
              selectedFile={primaryFile}
              onFileChange={(file, input) => applyPrimaryFile(file, input)}
              className="border border-dashed rounded-lg bg-card flex flex-col items-center justify-center p-8 cursor-pointer transition-colors group relative overflow-hidden"
              activeClassName="border-primary bg-primary/10"
              inactiveClassName="border-border hover:border-primary/50 hover:bg-accent"
            >
              {({ file }) => (
                <>
                  {file ? (
                    <>
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                        <CircleCheck size={24} className="text-primary" />
                      </div>
                      <p className="text-sm text-foreground font-medium mb-1 truncate w-full text-center px-4">
                        {file.name}
                      </p>
                      <p className="text-xs text-primary">Click to replace</p>
                    </>
                  ) : (
                    <>
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                        <FileUp size={24} className="text-primary" />
                      </div>
                      <p className="text-sm text-foreground font-medium mb-1">
                        Click to browse or drag file here
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Supported formats: .nii, .nii.gz
                      </p>
                    </>
                  )}
                </>
              )}
            </DashedFileDropZone>
            {primaryFileError && (
              <p className="text-xs text-destructive mt-2">{primaryFileError}</p>
            )}
          </div>

          {/* Segmentation Mask Input */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-1 uppercase tracking-wide">
              Segmentation Mask{" "}
              <span className="font-normal normal-case opacity-75">(Optional)</span>
            </label>

            <DashedFileDropZone
              selectedFile={segmentationFile}
              onFileChange={(file, input) => applyMaskFile(file, input)}
              className="border border-dashed rounded-lg bg-card flex flex-col items-center justify-center p-6 cursor-pointer transition-colors group relative overflow-hidden"
              activeClassName="border-primary bg-primary/10"
              inactiveClassName="border-border hover:border-primary/50 hover:bg-accent"
            >
              {({ isDropActive, file }) => (
                <div className="flex items-center gap-3">
                  {file ? (
                    <CircleCheck size={28} className="transition-colors text-primary" />
                  ) : (
                    <Braces
                      size={28}
                      className={`transition-colors ${isDropActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`}
                    />
                  )}
                  <div className="text-left">
                    <p
                      className={`text-sm transition-colors truncate max-w-[400px] ${file ? "text-primary font-medium" : isDropActive ? "text-primary font-medium" : "text-foreground font-medium group-hover:text-primary"}`}
                    >
                      {file ? file.name : "Add matching mask file"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {file ? "Click to replace" : "Drop an overlay NIfTI file"}
                    </p>
                  </div>
                </div>
              )}
            </DashedFileDropZone>
            {segmentationFileError && (
              <p className="text-xs text-destructive mt-2">{segmentationFileError}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" className="cursor-pointer" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={!primaryFile}>
              Open File
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
