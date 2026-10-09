import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export interface CancelPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Stop row click / selection when the dialog is used inside a table. */
  stopPropagation?: boolean;
}

export function CancelPipelineDialog({
  open,
  onOpenChange,
  onConfirm,
  stopPropagation = false,
}: CancelPipelineDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel processing?</AlertDialogTitle>
          <AlertDialogDescription>
            Stops the current run. You can retry this study afterward from Browse
            Studies.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep processing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Cancel processing
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
