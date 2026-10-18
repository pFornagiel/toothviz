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

export interface ResetViewDialogProps {
  open: boolean;
  selectedCount: number;
  presentCount: number;
  pickMode: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ResetViewDialog({
  open,
  selectedCount,
  presentCount,
  pickMode,
  onOpenChange,
  onConfirm,
}: ResetViewDialogProps) {
  const confirmedRef = useRef(false);
  const resetsTeeth = pickMode || selectedCount !== presentCount;
  const description = resetsTeeth
    ? "Restore default view settings. Also select all teeth and exit pick mode."
    : "Restore default view settings.";

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
          <AlertDialogTitle>Reset view?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmedRef.current = true;
              onOpenChange(false);
              onConfirm();
            }}
          >
            Reset view
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
