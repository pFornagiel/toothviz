import * as React from "react";
import { useNavigate, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { Button } from "../ui/button";
import { Tooth } from "../icons/tooth";
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
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isBrowse = location.pathname.startsWith("/browse");
  const isVisualize = location.pathname.startsWith("/visualize");

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="border-b border-border bg-card p-0 shadow-sm flex items-stretch">
        <div className="flex shrink-0 items-center gap-4 px-6 py-4">
          {showBackButton ? (
            <Button
              variant="ghost"
              onClick={handleBack}
              className="h-8 w-8 cursor-pointer text-foreground p-1"
            >
              <ChevronLeft className="w-8 h-7 text-foreground cursor-pointer" />
            </Button>
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center p-1 select-none"
              aria-hidden="true"
            >
              <Tooth className="!w-10 !h-10 text-primary" />
            </div>
          )}

          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        </div>
        {/* Navigation buttons */}
        <div className="flex items-stretch gap-2">
          <Button variant="link" onClick={() => navigate("/")} className={cn(
            "relative h-full rounded-none text-md cursor-pointer transition-colors duration-150 hover:no-underline",
            "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-1 after:content-[''] after:transition-colors after:duration-150",
            isHome
              ? "text-primary after:bg-primary hover:text-primary/80"
              : "text-foreground after:bg-transparent hover:text-primary hover:after:bg-primary/40"
            )}>
            Home
          </Button>
          <Button variant="link" onClick={() => navigate("/browse")} className={cn(
            "relative h-full rounded-none text-md cursor-pointer transition-colors duration-150 hover:no-underline",
            "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-1 after:content-[''] after:transition-colors after:duration-150",
            isBrowse || isVisualize
              ? "text-primary after:bg-primary hover:text-primary/80"
              : "text-foreground after:bg-transparent hover:text-primary hover:after:bg-primary/40"
            )}>
            Browse
          </Button>
        </div>
      </header>
      <main className={cn("flex-1", mainClassName)}>{children}</main>
    </div>
  );
}
