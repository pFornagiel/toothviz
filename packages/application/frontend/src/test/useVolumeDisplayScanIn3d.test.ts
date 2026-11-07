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
  it("hides the scan in the 3D render only, leaving its opacity for the 2D slices", () => {
    const { scan, result } = setup();
    act(() => result.current.setScanIn3d(false));
    expect(scan.renderOpacity).toBe(0);
    expect(scan.opacity).toBe(1);
    act(() => result.current.setScanIn3d(true));
    expect(scan.renderOpacity).toBeUndefined();
  });

  it("lets the scan's own checkbox apply again once the override is off", () => {
    const { result, nv } = setup();
    act(() => result.current.syncFromVolumes(nv));
    act(() => result.current.handleVolumeVisibilityToggle(0));
    expect(nv.setVolume).toHaveBeenCalledWith(0, { opacity: 0 });
    expect(result.current.scanIn3d).toBe(true);
  });

  it("carries the choice over to a newly loaded scan", () => {
    const { result, nv } = setup();
    act(() => result.current.setScanIn3d(false));
    const fresh: { renderOpacity?: number; opacity: number } = { opacity: 1 };
    nv.volumes[0] = fresh as unknown as NiiVueGPU["volumes"][number];
    act(() => result.current.syncFromVolumes(nv));
    expect(fresh.renderOpacity).toBe(0);
  });
});
