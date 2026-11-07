import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import useVolumeDisplayControls from "@/app/visualization/hooks/useVolumeDisplayControls";

function setup() {
  const scan: { renderOpacity?: number; opacity: number } = { opacity: 1 };
  const nv = {
    volumes: [scan, { opacity: 0.5 }],
    drawScene: vi.fn(),
    setVolume: vi.fn(async () => undefined),
  } as unknown as NiiVueGPU;
  const { result } = renderHook(() =>
    useVolumeDisplayControls({ nvRef: { current: nv }, queueNvUpdate: (_key, apply) => apply() }),
  );
  return { scan, nv, result };
}

describe("useVolumeDisplayControls scanIn3d", () => {
  it("starts with the scan out of the 3D render, leaving its opacity for the 2D slices", () => {
    const { scan, result } = setup();
    expect(result.current.scanIn3d).toBe(false);
    expect(scan.renderOpacity).toBe(0);
    expect(scan.opacity).toBe(1);
  });

  it("shows the scan in the 3D render once ticked, and reset takes it out again", () => {
    const { scan, result } = setup();
    act(() => result.current.setScanIn3d(true));
    expect(scan.renderOpacity).toBeUndefined();
    act(() => result.current.reset());
    expect(result.current.scanIn3d).toBe(false);
    expect(scan.renderOpacity).toBe(0);
  });

  it("keeps the scan in the 3D render when there is no mask to show instead", () => {
    const { scan, nv, result } = setup();
    nv.volumes.pop();
    act(() => result.current.syncFromVolumes(nv));
    expect(scan.renderOpacity).toBeUndefined();
  });

  it("leaves the choice alone when the scan's own checkbox hides it everywhere", () => {
    const { result, nv } = setup();
    act(() => result.current.setScanIn3d(true));
    act(() => result.current.syncFromVolumes(nv));
    act(() => result.current.handleVolumeVisibilityToggle(0));
    expect(nv.setVolume).toHaveBeenCalledWith(0, { opacity: 0 });
    expect(result.current.scanIn3d).toBe(true);
  });

  it("carries the choice over to a newly loaded scan", () => {
    const { result, nv } = setup();
    const fresh: { renderOpacity?: number; opacity: number } = { opacity: 1 };
    nv.volumes[0] = fresh as unknown as NiiVueGPU["volumes"][number];
    act(() => result.current.syncFromVolumes(nv));
    expect(fresh.renderOpacity).toBe(0);
  });
});
