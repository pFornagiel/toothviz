import { useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";

export interface ClearSelectionDialogProps {
  open: boolean;
  presentCount: number;
  pickMode: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ClearSelectionDialog({
  open,
  presentCount,
  pickMode,
  onOpenChange,
  onConfirm,
}: ClearSelectionDialogProps) {
  const confirmedRef = useRef(false);
  const description = pickMode
    ? `Clear all selected teeth. Pick mode stays on.`
    : `Clear selection. No teeth will be shown (${presentCount} detected).`;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (confirmedRef.current) {
            confirmedRef.current = false;
            return;
          }
          onOpenChange(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear selection?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              confirmedRef.current = true;
              onOpenChange(false);
              onConfirm();
            }}
          >
            Clear selection
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
