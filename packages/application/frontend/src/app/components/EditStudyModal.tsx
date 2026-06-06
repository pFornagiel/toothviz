import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { FileType, SegmentationType } from "../pipeline";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { StudyStatusIndicator } from "./StudyStatusIndicator";
import { StudyResponse } from "@/api/types";
import { renameStudy, deleteStudy } from "@/api/studies";

export interface EditStudyData {
  studyName: string;
  baseImageFile: File;
  fileType: FileType;
  segmentationType: SegmentationType;
  segmentationFile?: File;
}

interface EditStudyModalProps {
  study: StudyResponse;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function EditStudyModal({ study, isOpen, onClose, onSave }: EditStudyModalProps) {
  const [studyName, setStudyName] = useState(study.name);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (studyName && studyName !== study.name) {
      await renameStudy(study.id, studyName);
      onSave();
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!confirm("Delete this study?")) {
      return;
    }
    await deleteStudy(study.id);
    onSave();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-auto gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="text-xl font-semibold">Edit Scan Details</DialogTitle>
          <DialogDescription>
            Modify volume metadata and configuration.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="contents">
          <div className="flex flex-col gap-6 p-6">
            {/* Study Identifier Field */}
            <div className="flex flex-col gap-2">
              <label
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                htmlFor="studyName"
              >
                Scan Identifier
              </label>
              <input
                id="studyName"
                type="text"
                value={studyName}
                onChange={(e) => setStudyName(e.target.value)}
                required
                placeholder="e.g., Patient_Scan_2023_Axial"
                className="w-full rounded border border-border bg-muted/50 px-4 py-2 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground peer"
              />
              <p className="text-xs text-muted-foreground transition-colors peer-focus:text-primary">
                Use alphanumeric characters and underscores only.
              </p>
            </div>

            {/* Metadata Display */}
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </span>
                <StudyStatusIndicator status={study.status} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Created At
                </span>
                <span className="font-mono text-sm text-foreground">
                  {formatCreatedAt(study.created_at)}
                </span>
              </div>
              {study.error && (
                <div className="col-span-2 flex flex-col gap-1 border-t border-border pt-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Error
                  </span>
                  <span className="text-sm text-destructive">{study.error}</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 gap-3 px-6 py-4 sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="w-fit cursor-pointer gap-2 px-4 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 size={18} />
              Delete Scan
            </Button>
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <Button type="button" className="cursor-pointer px-6" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="cursor-pointer px-6" disabled={!studyName}>
                <Save size={18} />
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
