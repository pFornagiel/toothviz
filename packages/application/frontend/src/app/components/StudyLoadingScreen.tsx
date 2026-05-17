"use client";

import { Progress } from "./ui/progress";

const DEFAULT_LABELS: Record<string, string> = {
  dicom_to_nifti: "Converting DICOM to NIfTI",
  segment_nifti: "Running segmentation",
  anonymyse_dicom: "Anonymising DICOM",
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

function labelForStep(step: string): string {
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
      <h1 className="text-xl text-gray-200 mb-2">{title}</h1>
      <p className="text-sm text-gray-500 mb-6 max-w-md">{statusLine}</p>

      <div className="w-full max-w-md mb-8">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <Progress value={pct} className="h-3 bg-gray-700 [&_[data-slot=progress-indicator]]:bg-blue-500" />
      </div>

      {steps.length > 0 && (
        <ol className="w-full max-w-md text-left space-y-2 text-sm">
          {steps.map((step, idx) => {
            const done = completedSteps.has(idx);
            const active = !done && currentStepIndex === idx;
            return (
              <li
                key={`${step}-${idx}`}
                className={`flex items-center gap-2 rounded px-3 py-2 border ${
                  done
                    ? "border-green-800/60 bg-green-950/20 text-green-300"
                    : active
                      ? "border-blue-700/60 bg-blue-950/30 text-blue-200"
                      : "border-gray-700 text-gray-500"
                }`}
              >
                <span className="w-5 shrink-0 text-center">{done ? "✓" : active ? "…" : "○"}</span>
                <span>{labelForStep(step)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
