import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import useNiivueMeasurement from "@/app/visualization/hooks/useNiivueMeasurement";
import { ViewPhase } from "@/app/visualization/types";
import { SliceTypeKey } from "@/app/visualization/constants";

vi.mock("@niivue/niivue", () => ({
  DRAG_MODE: { measurement: 2 },
  SLICE_TYPE: { AXIAL: 0, CORONAL: 1, SAGITTAL: 2 },
}));

// jsdom has no PointerEvent; the handlers only need MouseEvent's fields.
vi.stubGlobal("PointerEvent", MouseEvent);

type StoredMeasurement = {
  distance: number;
  sliceType: number;
  startMM: number[];
  endMM: number[];
};

const NORMAL_DRAG_MODE = 8;
const MEASUREMENT_DRAG_MODE = 2;

function setup({ hit = { isRender: false, tileIndex: 0 } as object | null } = {}) {
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.setPointerCapture = vi.fn();
  // Drawn at half size: tile [100, 50, 200, 100] covers x 60-160, y 45-95 on the page.
  canvas.width = 800;
  canvas.height = 400;
  canvas.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 400, height: 200 }) as DOMRect;
  container.appendChild(canvas);
  document.body.appendChild(container);

  const nv = {
    primaryDragMode: NORMAL_DRAG_MODE,
    drawScene: vi.fn(),
    clearMeasurements: vi.fn(() => {
      nv.model.completedMeasurements.length = 0;
    }),
    view: { hitTest: () => hit, screenSlices: [{ leftTopWidthHeight: [100, 50, 200, 100] }] },
    setCrosshairPos: vi.fn(),
    pan2Dxyzmm: [0, 0, 0, 1],
    model: {
      extentsMin: [0, 0, 0],
      extentsMax: [100, 100, 100],
      completedMeasurements: [] as StoredMeasurement[],
    },
  };

  // Stands in for NiiVue's listeners, which come after the hook's capture listeners.
  const seen: string[] = [];
  const moves: [number, number][] = [];
  let distance = 12;
  for (const type of ["pointerdown", "pointerup", "wheel", "dblclick"]) {
    canvas.addEventListener(type, () => {
      seen.push(type);
      if (type === "pointerup") {
        nv.model.completedMeasurements.push({
          distance,
          sliceType: 1,
          startMM: [10, 20, 30],
          endMM: [30, 20, 50],
        });
      }
    });
  }
  canvas.addEventListener("pointermove", (e) => moves.push([e.clientX, e.clientY]));

  const canvasRef = { current: canvas };
  const nvRef = { current: nv as unknown as NiiVueGPU };
  const onShowPlane = vi.fn();
  const hook = renderHook(
    (props: { available: boolean; layoutKey: string }) =>
      useNiivueMeasurement({
        canvasRef,
        nvRef,
        viewPhase: ViewPhase.Ready,
        onShowPlane,
        ...props,
      }),
    { initialProps: { available: true, layoutKey: "grid" } },
  );

  const fire = (type: string, init: MouseEventInit = {}) =>
    act(() => {
      canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    });
  const click = async (x = 10, y = 10) => {
    fire("pointerdown", { button: 0, clientX: x, clientY: y });
    fire("pointerup", { button: 0, clientX: x, clientY: y });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  };
  const setDistance = (value: number) => {
    distance = value;
  };

  return { nv, canvas, hook, seen, moves, onShowPlane, fire, click, setDistance };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useNiivueMeasurement", () => {
  it("measures with two clicks, then leaves measuring by itself", async () => {
    const { nv, hook, seen, click } = setup();

    act(() => hook.result.current.start());
    expect(hook.result.current.phase).toBe("firstPoint");
    expect(nv.primaryDragMode).toBe(MEASUREMENT_DRAG_MODE);

    await click(10, 10);
    expect(hook.result.current.phase).toBe("secondPoint");
    expect(seen).toEqual(["pointerdown"]); // NiiVue keeps "dragging" towards the pointer.

    await click(80, 40);
    expect(seen).toEqual(["pointerdown", "pointerup"]);
    expect(hook.result.current.phase).toBe("off");
    expect(hook.result.current.measurements).toHaveLength(1);
    expect(nv.primaryDragMode).toBe(NORMAL_DRAG_MODE);
  });

  it("also accepts dragging from one point to the other", async () => {
    const { hook, fire } = setup();
    act(() => hook.result.current.start());
    fire("pointerdown", { button: 0, clientX: 10, clientY: 10 });
    fire("pointerup", { button: 0, clientX: 90, clientY: 10 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(hook.result.current.phase).toBe("off");
    expect(hook.result.current.measurements).toHaveLength(1);
  });

  it("leaves the first click to other tools on the 3D tile", async () => {
    const { hook, seen, click } = setup({ hit: { isRender: true } });
    act(() => hook.result.current.start());
    await click();
    expect(hook.result.current.phase).toBe("firstPoint");
    expect(seen).toEqual(["pointerdown", "pointerup"]);
  });

  it("blocks the wheel and other buttons only while a point is set", async () => {
    const { hook, seen, fire, click } = setup();
    act(() => hook.result.current.start());

    fire("wheel");
    expect(seen).toEqual(["wheel"]);

    await click();
    seen.length = 0;
    fire("wheel");
    fire("pointerdown", { button: 1 });
    fire("pointerup", { button: 1 });
    expect(seen).toEqual([]);
    expect(hook.result.current.phase).toBe("secondPoint");
  });

  it("keeps the second point on the first point's tile", async () => {
    const { hook, moves, fire, click } = setup();
    fire("pointermove", { clientX: 500, clientY: 500 });
    expect(moves).toEqual([[500, 500]]); // Not measuring yet: untouched.
    moves.length = 0;

    act(() => hook.result.current.start());
    await click(100, 70);

    fire("pointermove", { clientX: 120, clientY: 80 });
    fire("pointermove", { clientX: 500, clientY: 10 });
    expect(moves).toEqual([
      [120, 80],
      [160, 45],
    ]);
    moves.length = 0;

    // Leaving the canvas, e.g. over the sidebar, also stops at the tile's edge.
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 0, clientY: 70 }),
      );
    });
    expect(moves).toEqual([[60, 70]]);
  });

  it("Esc drops the unfinished measurement and keeps earlier ones", async () => {
    const { nv, hook, click } = setup();
    act(() => hook.result.current.start());
    await click(10, 10);
    await click(50, 50);
    expect(nv.model.completedMeasurements).toHaveLength(1);

    act(() => hook.result.current.start());
    await click(20, 20);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(hook.result.current.phase).toBe("off");
    expect(nv.model.completedMeasurements).toHaveLength(1);
    expect(hook.result.current.measurements).toHaveLength(1);
    expect(nv.primaryDragMode).toBe(NORMAL_DRAG_MODE);
  });

  it("does not keep a measurement of zero length", async () => {
    const { nv, hook, click, setDistance } = setup();
    setDistance(0);
    act(() => hook.result.current.start());
    await click();
    await click();
    expect(nv.model.completedMeasurements).toHaveLength(0);
    expect(hook.result.current.measurements).toHaveLength(0);
  });

  it("stops the second click's double click from reaching the tile", async () => {
    const { hook, seen, fire, click } = setup();
    act(() => hook.result.current.start());
    await click();
    await click();
    seen.length = 0;
    fire("dblclick");
    expect(seen).toEqual([]);
  });

  it("cancels when it stops being available or the layout changes", async () => {
    const { hook, click } = setup();
    act(() => hook.result.current.start());
    await click();
    hook.rerender({ available: false, layoutKey: "grid" });
    expect(hook.result.current.phase).toBe("off");

    hook.rerender({ available: true, layoutKey: "grid" });
    act(() => hook.result.current.start());
    hook.rerender({ available: true, layoutKey: "axial" });
    expect(hook.result.current.phase).toBe("off");
  });

  async function measureTwice(ctx: ReturnType<typeof setup>) {
    act(() => ctx.hook.result.current.start());
    await ctx.click(10, 10);
    await ctx.click(50, 50);
    ctx.setDistance(30);
    act(() => ctx.hook.result.current.start());
    await ctx.click(10, 10);
    await ctx.click(50, 50);
  }

  it("lists measurements with their value and plane", async () => {
    const ctx = setup();
    await measureTwice(ctx);
    expect(ctx.hook.result.current.measurements).toEqual([
      { distance: 12, plane: SliceTypeKey.Coronal, name: "" },
      { distance: 30, plane: SliceTypeKey.Coronal, name: "" },
    ]);
  });

  it("renames a measurement and keeps the name after removing another", async () => {
    const ctx = setup();
    await measureTwice(ctx);
    act(() => ctx.hook.result.current.rename(1, "Root length"));
    expect(ctx.hook.result.current.measurements[1]?.name).toBe("Root length");
    act(() => ctx.hook.result.current.remove(0));
    expect(ctx.hook.result.current.measurements).toEqual([
      { distance: 30, plane: SliceTypeKey.Coronal, name: "Root length" },
    ]);
  });

  it("marks a finished measurement for rename", async () => {
    const { hook, click } = setup();
    expect(hook.result.current.pendingRenameIndex).toBeNull();
    act(() => hook.result.current.start());
    await click(10, 10);
    await click(50, 50);
    expect(hook.result.current.pendingRenameIndex).toBe(0);
    act(() => hook.result.current.clearPendingRename());
    expect(hook.result.current.pendingRenameIndex).toBeNull();
  });

  it("removes only the chosen measurement", async () => {
    const ctx = setup();
    await measureTwice(ctx);
    act(() => ctx.hook.result.current.remove(0));
    expect(ctx.nv.model.completedMeasurements.map((m) => m.distance)).toEqual([30]);
    expect(ctx.hook.result.current.measurements.map((m) => m.distance)).toEqual([30]);
    expect(ctx.nv.drawScene).toHaveBeenCalled();
  });

  it("goes to the middle of a measurement and shows its plane", async () => {
    const ctx = setup();
    await measureTwice(ctx);
    act(() => ctx.hook.result.current.goTo(1));
    expect(ctx.onShowPlane).toHaveBeenCalledWith(SliceTypeKey.Coronal);
    expect(ctx.nv.setCrosshairPos).toHaveBeenCalledWith([20, 20, 40]);
    expect(ctx.nv.pan2Dxyzmm).toEqual([0, 0, 0, 1]); // An untouched view stays as it is.
  });

  it("brings a measurement to the middle of a zoomed view", async () => {
    const ctx = setup();
    await measureTwice(ctx);
    ctx.nv.pan2Dxyzmm = [5, 5, 5, 3];
    act(() => ctx.hook.result.current.goTo(0));
    expect(ctx.nv.pan2Dxyzmm).toEqual([30, 30, 10, 3]);
  });

  it("clear and reset remove the measurements", async () => {
    const { nv, hook, click } = setup();
    act(() => hook.result.current.start());
    await click(10, 10);
    await click(50, 50);

    act(() => hook.result.current.clear());
    expect(nv.model.completedMeasurements).toHaveLength(0);
    expect(hook.result.current.measurements).toHaveLength(0);

    act(() => hook.result.current.start());
    await click();
    act(() => hook.result.current.reset());
    expect(hook.result.current.phase).toBe("off");
    expect(nv.model.completedMeasurements).toHaveLength(0);
  });
});
