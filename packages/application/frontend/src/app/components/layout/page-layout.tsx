import * as React from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  title?: string;
  showBackButton?: boolean;
  onBack?: () => void;
  children: React.ReactNode;
  mainClassName?: string;
}

export function PageLayout({
  title="ToothViz",
  showBackButton = false,
  onBack,
  children,
  mainClassName,
}: PageLayoutProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="border-b border-border bg-card px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          {showBackButton && (
            <button
              onClick={handleBack}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              &larr;
            </button>
          )}
          <h1 className="text-xl text-foreground font-semibold tracking-tight">{title}</h1>
        </div>
      </header>
      <main className={cn("flex-1", mainClassName)}>{children}</main>
    </div>
  );
}
