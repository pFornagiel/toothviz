import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import useNiivueCanvasWheel from "@/app/visualization/hooks/useNiivueCanvasWheel";
import useNiivueMiddleButtonPan from "@/app/visualization/hooks/useNiivueMiddleButtonPan";
import { ViewPhase } from "@/app/visualization/types";

vi.mock("@niivue/niivue", () => ({
  SLICE_TYPE: { AXIAL: 0, CORONAL: 1, SAGITTAL: 2, MULTIPLANAR: 3, RENDER: 4 },
}));

// jsdom has no PointerEvent; the button handling under test only needs MouseEvent's fields.
vi.stubGlobal("PointerEvent", MouseEvent);

const AXIAL_HIT = { isRender: false, sliceType: 0 };
const CORONAL_HIT = { isRender: false, sliceType: 1 };
const RENDER_HIT = { isRender: true };

function setup(hit: object) {
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  document.body.appendChild(container);

  const nv = {
    sliceType: 3,
    scaleMultiplier: 1,
    pan2Dxyzmm: [0, 0, 0, 1],
    crosshairPos: [0.5, 0.5, 0.5],
    moveCrosshairInVox: vi.fn(),
    model: { scene2mm: () => [0, 0, 0] },
    view: { hitTest: () => hit },
  };
  const canvasRef = { current: canvas };
  const nvRef = { current: nv as unknown as NiiVueGPU };
  return { container, canvas, nv, canvasRef, nvRef };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useNiivueCanvasWheel", () => {
  function setupWheel(hit: object) {
    const ctx = setup(hit);
    const setRenderZoom = vi.fn();
    renderHook(() =>
      useNiivueCanvasWheel({
        canvasRef: ctx.canvasRef,
        nvRef: ctx.nvRef,
        viewPhase: ViewPhase.Ready,
        setClipPlaneDepth: vi.fn(),
        setRenderZoom,
      }),
    );
    const wheel = (init: WheelEventInit) =>
      ctx.canvas.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }),
      );
    return { ...ctx, setRenderZoom, wheel };
  }

  it("moves through slices of the hovered plane on plain scroll", () => {
    const { nv, wheel } = setupWheel(CORONAL_HIT);
    wheel({ deltaY: 100 });
    expect(nv.moveCrosshairInVox).toHaveBeenCalledWith(0, 1, 0);
    expect(nv.pan2Dxyzmm[3]).toBe(1);
  });

  it("zooms the 2D view on Ctrl+scroll without changing the slice", () => {
    const { nv, wheel } = setupWheel(AXIAL_HIT);
    wheel({ deltaY: -100, ctrlKey: true });
    expect(nv.pan2Dxyzmm[3]).toBeGreaterThan(1);
    expect(nv.moveCrosshairInVox).not.toHaveBeenCalled();
  });

  it.each([false, true])("zooms the 3D tile regardless of Ctrl (ctrl=%s)", (ctrlKey) => {
    const { nv, setRenderZoom, wheel } = setupWheel(RENDER_HIT);
    wheel({ deltaY: -100, ctrlKey });
    expect(nv.scaleMultiplier).toBeGreaterThan(1);
    expect(setRenderZoom).toHaveBeenCalledWith(nv.scaleMultiplier);
    expect(nv.moveCrosshairInVox).not.toHaveBeenCalled();
  });
});

describe("useNiivueMiddleButtonPan", () => {
  function setupPan(hit: object) {
    const ctx = setup(hit);
    renderHook(() =>
      useNiivueMiddleButtonPan({
        canvasRef: ctx.canvasRef,
        nvRef: ctx.nvRef,
        viewPhase: ViewPhase.Ready,
      }),
    );
    // Stands in for NiiVue's own listener on the canvas.
    const buttons: number[] = [];
    ctx.canvas.addEventListener("pointerdown", (e) => buttons.push(e.button));
    const press = (button: number) =>
      ctx.canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button,
          clientX: 5,
          clientY: 5,
        }),
      );
    return { ...ctx, buttons, press };
  }

  it("hands a middle press on a slice tile to NiiVue as a right press", () => {
    const { buttons, press } = setupPan(AXIAL_HIT);
    press(1);
    expect(buttons).toEqual([2]);
  });

  it("swallows a middle press on the 3D tile", () => {
    const { buttons, press } = setupPan(RENDER_HIT);
    press(1);
    expect(buttons).toEqual([]);
  });

  it("leaves other buttons untouched", () => {
    const { buttons, press } = setupPan(AXIAL_HIT);
    press(0);
    press(2);
    expect(buttons).toEqual([0, 2]);
  });

  it("blocks the browser's middle-click autoscroll", () => {
    const { canvas } = setupPan(AXIAL_HIT);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});
