"use client";

import { Progress } from "../../components/ui/progress";

const DEFAULT_LABELS: Record<string, string> = {
  dicom_to_nifti: "Converting DICOM to NIfTI",
  segment_nifti: "Running segmentation",
  anonymyse_dicom: "Anonymising DICOM",
  stub: "Stub (testing)",
  passthrough: "Passthrough to viewer",
  upload_volume: "Uploading volume",
  upload_mask: "Uploading segmentation mask",
  finalize_upload: "Finalising on server",
  load_volume: "Loading volume",
  load_mask: "Loading overlay",
};

export interface StudyLoadingScreenProps {
  title?: string;
  steps: string[];
  completedSteps: Set<number>;
  currentStepIndex: number | null;
  /** 0–1 from backend; optional if deriving from steps only */
  progressFraction: number | null;
  statusLine: string;
}

function getLabelForStep(step: string): string {
  return DEFAULT_LABELS[step] ?? step.replace(/_/g, " ");
}

export function StudyLoadingScreen({
  title = "Processing study",
  steps,
  completedSteps,
  currentStepIndex,
  progressFraction,
  statusLine,
}: StudyLoadingScreenProps) {
  const derived =
    steps.length > 0
      ? Array.from(completedSteps).length / steps.length
      : 0;
  const pct =
    progressFraction != null
      ? Math.round(Math.min(1, Math.max(0, progressFraction)) * 100)
      : Math.round(derived * 100);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="text-2xl text-foreground font-semibold tracking-tight mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">{statusLine}</p>

      <div className="w-full max-w-md mb-8">
        <div className="flex justify-between text-xs font-medium text-muted-foreground mb-2">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <Progress value={pct} className="h-2 bg-muted [&_[data-slot=progress-indicator]]:bg-primary" />
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
                <span className="w-5 shrink-0 text-center font-bold">{done ? "✓" : active ? "…" : "○"}</span>
                <span>{getLabelForStep(step)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
