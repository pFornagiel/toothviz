import { useState } from "react";
import { SquarePlus, Trash } from "lucide-react";
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
      <DialogContent className="h-auto overflow-y-aut min-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Study Details</DialogTitle>
          <DialogDescription>Edit Patient Study Details.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-4">
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium uppercase tracking-wider text-foreground"
              htmlFor="studyName"
            >
              Study Identifier
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

          <div className="flex flex-col gap-2">
            {study.status}
            {study.created_at}
            {study.error}
          </div>
          <Button
            type="button"
            className="w-fit self-center cursor-pointer"
            variant="destructive"
            onClick={handleDelete}
          >
            <Trash size={18} />
            Delete Study
          </Button>

          <DialogFooter className="items-center sm:justify-between mt-4">
            <div className="flex gap-4">
              <Button type="button" className="cursor-pointer" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="cursor-pointer" disabled={!studyName}>
                <SquarePlus size={18} />
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
