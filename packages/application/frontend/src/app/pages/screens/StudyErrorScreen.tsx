"use client";

export interface StudyErrorScreenProps {
  title: string;
  message: string;
  hints: string[];
  backLabel: string;
  onBack: () => void;
  /** When set, show a primary Retry action (e.g. upload succeeded but pipeline failed). */
  retryLabel?: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export function StudyErrorScreen({
  title,
  message,
  hints,
  backLabel,
  onBack,
  retryLabel = "Retry processing",
  onRetry,
  retryDisabled = false,
}: StudyErrorScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6">
      <div className="max-w-lg w-full rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-left shadow-sm">
        <h1 className="text-xl text-destructive font-semibold mb-3 tracking-tight">{title}</h1>
        <p className="text-sm text-foreground/90 whitespace-pre-wrap mb-6">{message}</p>
        {hints.length > 0 && (
          <div className="mb-8">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              What you can try
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              {hints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
              className="w-full sm:w-auto px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors text-sm shadow-sm disabled:opacity-50"
            >
              {retryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="w-full sm:w-auto px-4 py-2 rounded bg-card border border-border text-foreground hover:bg-muted font-medium transition-colors text-sm shadow-sm"
          >
            {backLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
