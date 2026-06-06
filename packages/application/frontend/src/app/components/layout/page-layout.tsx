import * as React from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { Button } from "../ui/button";
interface PageLayoutProps {
  title?: string;
  showBackButton?: boolean;
  onBack?: () => void;
  children: React.ReactNode;
  mainClassName?: string;
}

export function PageLayout({
  title = "ToothViz",
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
            // <Button
            // variant="ghost"
            // className="absolute top-2 right-2 h-8 w-8 p-0"
            // >
            <Button
              variant="ghost"
              onClick={handleBack}
              className="h-8 w-8 cursor-pointer text-foreground p-1"
            >
              <ChevronLeft className="w-8 h-7 text-foreground cursor-pointer" />
            </Button>
          )}
          <h1 className="text-xl text-foreground font-semibold tracking-tight">{title}</h1>
        </div>
      </header>
      <main className={cn("flex-1", mainClassName)}>{children}</main>
    </div>
  );
}
