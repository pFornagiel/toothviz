"use client";

import { PipelineStepName, ClientStepName, BackendStepName, LoadingStepId } from "@/api/types";
import { Progress } from "../../components/ui/progress";
import { Button } from "../../components/ui/button";

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
  /** When set, the connection was lost; render a Reconnect button. */
  onReconnect?: () => void;
}

function getLabelForStep(step: LoadingStepId): string {
  return DEFAULT_LABELS[step] ?? step.replace(/_/g, " ");
}

export function StudyLoadingScreen({
  title = "Processing study",
  steps,
  completedSteps,
  currentStepIndex,
  progressFraction,
  statusLine,
  onReconnect,
}: StudyLoadingScreenProps) {
  const pct = Math.round(Math.min(1, Math.max(0, progressFraction)) * 100);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="text-2xl text-foreground font-semibold tracking-tight mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">{statusLine}</p>

      {onReconnect && (
        <Button type="button" onClick={onReconnect} className="mb-6">
          Reconnect
        </Button>
      )}

      <div className="w-full max-w-md mb-8">
        <div className="flex justify-between text-xs font-medium text-muted-foreground mb-2">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <Progress
          value={pct}
          className="h-2 bg-muted [&_[data-slot=progress-indicator]]:bg-primary"
        />
      </div>

      {steps.length > 0 && (
        <ol className="w-full max-w-md text-left space-y-2 text-sm">
          {steps.map((step, idx) => {
            const done = completedSteps.has(idx);
            const active = !done && currentStepIndex === idx;
            return (
              <li
                key={`${step}-${idx}`}
                className={`flex items-center gap-2 rounded px-3 py-2 border font-medium transition-colors ${
                  done
                    ? "border-emerald-600/30 bg-emerald-600/5 text-emerald-600"
                    : active
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border text-muted-foreground"
                }`}
              >
                <span className="w-5 shrink-0 text-center font-bold">
                  {done ? "✓" : active ? "..." : "○"}
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
