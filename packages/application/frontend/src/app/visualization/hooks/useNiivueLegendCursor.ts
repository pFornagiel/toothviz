import { useEffect, type RefObject } from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import type { ViewPhase } from "../types";

/** Matches NiiVue `Mn` in NVLegend layout / hit-test. */
const LEGEND_LINE_HEIGHT = 1.2;

type LegendLayoutLike = {
  entries: unknown[];
  x: number;
  y: number;
  width: number;
  boxSize: number;
  gap: number;
  margin?: number;
};

type LegendHit = {
  /** True when pointer is over the legend panel (including row gaps / padding). */
  overLegend: boolean;
  /** Row index under the pointer, or -1 when in padding/gap only. */
  rowIndex: number;
  rowY: number;
  rowHeight: number;
};

function hitTestLegend(layout: LegendLayoutLike, canvasX: number, canvasY: number): LegendHit {
  const empty: LegendHit = { overLegend: false, rowIndex: -1, rowY: 0, rowHeight: 0 };
  if (!layout.entries.length) {
    return empty;
  }

  const rowHeight = layout.boxSize * LEGEND_LINE_HEIGHT;
  const contentHeight =
    layout.entries.length * rowHeight + (layout.entries.length - 1) * layout.gap;
  const pad = (layout.margin ?? 0) * 0.5;
  const left = layout.x + pad;
  const top = layout.y - pad;
  const width = layout.width - pad * 2;
  const height = contentHeight + pad * 2;

  if (
    canvasX < left ||
    canvasX > left + width ||
    canvasY < top ||
    canvasY > top + height
  ) {
    return empty;
  }

  let rowY = layout.y;
  for (let i = 0; i < layout.entries.length; i++) {
    if (canvasY >= rowY && canvasY < rowY + rowHeight) {
      return { overLegend: true, rowIndex: i, rowY, rowHeight };
    }
    rowY += rowHeight + layout.gap;
  }

  return { overLegend: true, rowIndex: -1, rowY: 0, rowHeight };
}

/**
 * Pointer cursor + row highlight when hovering NiiVue's label color legend
 * (drawn on the canvas), so it reads as UI chrome rather than volume picking.
 */
export default function useNiivueLegendCursor({
  canvasRef,
  nvRef,
  viewPhase,
  enabled,
  pickCursor = "",
  lightBackground = false,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nvRef: RefObject<NiiVueGPU | null>;
  viewPhase: ViewPhase;
  /** When false (e.g. mask hidden), do not change the cursor for the legend. */
  enabled: boolean;
  /** Cursor to restore when leaving the legend (e.g. "cell" in pick mode). */
  pickCursor?: string;
  /** Match highlight contrast to canvas background. */
  lightBackground?: boolean;
}): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) {
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }

    const highlight = document.createElement("div");
    highlight.setAttribute("aria-hidden", "true");
    const fill = lightBackground ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.22)";
    const stroke = lightBackground ? "rgba(15,23,42,0.28)" : "rgba(255,255,255,0.35)";
    highlight.style.cssText = [
      "position:absolute",
      "pointer-events:none",
      "display:none",
      "z-index:5",
      "border-radius:4px",
      `background:${fill}`,
      `box-shadow:inset 0 0 0 1px ${stroke}`,
      "transition:top 60ms linear,left 60ms linear,width 60ms linear,height 60ms linear",
    ].join(";");
    parent.appendChild(highlight);

    const hideHighlight = () => {
      highlight.style.display = "none";
    };

    const syncHighlight = (layout: LegendLayoutLike, hit: LegendHit) => {
      if (hit.rowIndex < 0) {
        hideHighlight();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
        hideHighlight();
        return;
      }
      const sx = rect.width / canvas.width;
      const sy = rect.height / canvas.height;
      const pad = (layout.margin ?? 0) * 0.5;
      highlight.style.display = "block";
      highlight.style.left = `${(layout.x + pad) * sx}px`;
      highlight.style.top = `${hit.rowY * sy}px`;
      highlight.style.width = `${(layout.width - pad * 2) * sx}px`;
      highlight.style.height = `${hit.rowHeight * sy}px`;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const nv = nvRef.current;
      const layout = (nv?.view as { legendLayout?: LegendLayoutLike | null } | null | undefined)
        ?.legendLayout;
      if (!layout || !nv?.isLegendVisible) {
        if (canvas.style.cursor === "pointer") {
          canvas.style.cursor = pickCursor;
        }
        hideHighlight();
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      const hit = hitTestLegend(layout, x, y);
      canvas.style.cursor = hit.overLegend ? "pointer" : pickCursor;
      syncHighlight(layout, hit);
    };

    const handlePointerLeave = () => {
      canvas.style.cursor = pickCursor;
      hideHighlight();
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      if (canvas.style.cursor === "pointer") {
        canvas.style.cursor = pickCursor;
      }
      highlight.remove();
    };
  }, [canvasRef, nvRef, viewPhase, enabled, pickCursor, lightBackground]);
}
