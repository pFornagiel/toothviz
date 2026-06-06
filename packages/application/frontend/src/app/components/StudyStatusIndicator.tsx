import { cn } from "@/lib/utils";

interface StatusStyle {
  dot: string;
  text: string;
}

export function getStatusIndicator(status: string): StatusStyle {
  switch (status) {
    case "ready":
      return { dot: "bg-emerald-600", text: "text-emerald-600" };
    case "processing":
      return { dot: "bg-amber-500", text: "text-amber-600" };
    case "failed":
      return { dot: "bg-destructive", text: "text-destructive" };
    case "cancelled":
      return { dot: "bg-orange-500", text: "text-orange-500" };
    default:
      return { dot: "bg-muted-foreground", text: "text-muted-foreground" };
  }
}

interface StudyStatusIndicatorProps {
  status: string;
  className?: string;
}

export function StudyStatusIndicator({ status, className }: StudyStatusIndicatorProps) {
  const style = getStatusIndicator(status);
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className={cn("size-2 rounded-full", style.dot)} />
      <span className={cn("text-sm font-medium capitalize", style.text)}>{status}</span>
    </span>
  );
}
