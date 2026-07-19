"use client";

import { PipelineStepName, ClientStepName, BackendStepName, LoadingStepId } from "@/api/types";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";

const DEFAULT_LABELS: Record<LoadingStepId, string> = {
  [BackendStepName.DicomToNifti]: "Converting DICOM to NIfTI",
  [PipelineStepName.SegmentNifti]: "Running segmentation",
  [PipelineStepName.Stub]: "Stub (testing)",
  [PipelineStepName.Passthrough]: "Passthrough to viewer",
  [ClientStepName.UploadVolume]: "Uploading volume",
  [ClientStepName.UploadMask]: "Uploading segmentation mask",
  [ClientStepName.FinalizeUpload]: "Finalising on server",
  [ClientStepName.LoadVolume]: "Loading volume",
  [ClientStepName.LoadMask]: "Loading overlay",
};

export interface StudyLoadingScreenProps {
  title?: string;
  steps: LoadingStepId[];
  completedSteps: Set<number>;
  currentStepIndex: number | null;
  progressFraction: number;
  statusLine: string;
  previewAvailable?: boolean;
  pipelineFinished?: boolean;
  onPreviewRawScan?: () => void;
}

function getLabelForStep(step: LoadingStepId): string {
  return DEFAULT_LABELS[step] ?? step.replace(/_/g, " ");
}

function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={`shrink-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin ${className ?? ""}`}
      aria-hidden
    />
  );
}

export function StudyLoadingScreen({
  title = "Processing scan",
  steps,
  completedSteps,
  currentStepIndex,
  progressFraction,
  statusLine,
  previewAvailable = false,
  pipelineFinished = false,
  onPreviewRawScan,
}: StudyLoadingScreenProps) {
  const pct = Math.round(Math.min(1, Math.max(0, progressFraction)) * 100);
  const showPreviewChoice = previewAvailable && !pipelineFinished && onPreviewRawScan != null;
  const isRunning = !pipelineFinished;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="mb-2 text-2xl text-foreground font-semibold tracking-tight">{title}</h1>
      <p
        className={`text-sm text-muted-foreground mb-6 max-w-md transition-opacity ${
          isRunning ? "animate-pulse" : ""
        }`}
      >
        {statusLine}
      </p>

      {pipelineFinished && (
        <Alert className="w-full max-w-md mb-6 border-primary/30 bg-primary/5 text-left">
          <AlertTitle>Processing complete</AlertTitle>
          <AlertDescription>
            Segmentation and other pipeline steps finished. Loading results in the viewer now.
          </AlertDescription>
        </Alert>
      )}

      {showPreviewChoice && (
        <div className="mb-6 flex w-full max-w-md flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-left animate-in fade-in-0 slide-in-from-top-1 duration-300">
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-tight text-foreground">
              Scan ready to preview
            </p>
            <p className="text-sm text-muted-foreground">
              Results load when processing finishes.
            </p>
          </div>
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onPreviewRawScan}>
            Open preview
          </Button>
        </div>
      )}

      <div className="w-full max-w-md mb-8">
        <div className="flex justify-between text-xs font-medium text-muted-foreground mb-2">
          <span>Progress</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="relative">
          <Progress
            value={pct}
            className="h-2 bg-muted [&_[data-slot=progress-indicator]]:bg-primary [&_[data-slot=progress-indicator]]:transition-[transform] [&_[data-slot=progress-indicator]]:duration-500 [&_[data-slot=progress-indicator]]:ease-out"
          />
          {isRunning && (
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
              aria-hidden
            >
              <div className="pipeline-progress-shimmer absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-primary-foreground/25 to-transparent" />
            </div>
          )}
        </div>
      </div>

      {steps.length > 0 && (
        <ol className="w-full max-w-md text-left space-y-2 text-sm">
          {steps.map((step, idx) => {
            const done = completedSteps.has(idx);
            const active = !done && currentStepIndex === idx;
            return (
              <li
                key={`${step}-${idx}`}
                className={`flex items-center gap-2 rounded px-3 py-2 border font-medium transition-all duration-300 ${
                  done
                    ? "border-emerald-600/30 bg-emerald-600/5 text-emerald-600"
                    : active
                      ? "border-primary/30 bg-primary/5 text-primary shadow-sm shadow-primary/10"
                      : "border-border text-muted-foreground"
                }`}
              >
                <span className="flex w-5 shrink-0 items-center justify-center">
                  {done ? (
                    <span className="font-bold" aria-hidden>
                      ✓
                    </span>
                  ) : active ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <span className="font-bold opacity-60" aria-hidden>
                      ○
                    </span>
                  )}
                </span>
                <span>{getLabelForStep(step)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
