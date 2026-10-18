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

export interface SelectAllDialogProps {
  open: boolean;
  presentCount: number;
  pickMode: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function SelectAllDialog({
  open,
  presentCount,
  pickMode,
  onOpenChange,
  onConfirm,
}: SelectAllDialogProps) {
  const confirmedRef = useRef(false);
  const description = pickMode
    ? `Select all ${presentCount} detected teeth. Pick mode stays on.`
    : `Select and show all ${presentCount} detected teeth.`;

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
          <AlertDialogTitle>Select all teeth?</AlertDialogTitle>
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
            Select all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
