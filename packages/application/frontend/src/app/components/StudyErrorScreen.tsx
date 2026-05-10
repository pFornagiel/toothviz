"use client";

export interface StudyErrorScreenProps {
  title: string;
  message: string;
  hints: string[];
  backLabel: string;
  onBack: () => void;
}

export function StudyErrorScreen({
  title,
  message,
  hints,
  backLabel,
  onBack,
}: StudyErrorScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6">
      <div className="max-w-lg w-full rounded-lg border border-red-800/50 bg-red-950/20 p-8 text-left">
        <h1 className="text-lg text-red-200 font-medium mb-3">{title}</h1>
        <p className="text-sm text-red-100/90 whitespace-pre-wrap mb-6">{message}</p>
        {hints.length > 0 && (
          <div className="mb-8">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">What you can try</p>
            <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
              {hints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto px-4 py-2 rounded bg-gray-800 border border-gray-600 text-gray-200 hover:bg-gray-750 text-sm"
        >
          {backLabel}
        </button>
      </div>
    </div>
  );
}
