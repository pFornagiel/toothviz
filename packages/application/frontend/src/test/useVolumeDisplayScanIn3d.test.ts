import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import useVolumeDisplayControls, {
  resolveOverlayVolumeIndex,
  resolveScanVolumeIndex,
} from "@/app/visualization/hooks/useVolumeDisplayControls";
import { DEFAULT_OVERLAY_NAME } from "@/app/visualization/constants";

type TestVolume = { opacity: number; name: string; renderOpacity?: number };

function setup(volumeCount = 2) {
  const volumes: TestVolume[] = Array.from({ length: volumeCount }, (_, i) => ({
    opacity: i === 0 ? 1 : 0.5,
    name: i === 0 ? "scan" : DEFAULT_OVERLAY_NAME,
  }));
  const nv = {
    volumes,
    drawScene: vi.fn(),
    setVolume: vi.fn(async () => undefined),
  } as unknown as NiiVueGPU;
  const { result } = renderHook(() =>
    useVolumeDisplayControls({ nvRef: { current: nv }, queueNvUpdate: (_key, apply) => apply() }),
  );
  act(() => result.current.syncFromVolumes(nv));
  return { scan: volumes[0], nv, result, volumes };
}

describe("resolveScanVolumeIndex", () => {
  it("picks the first volume that is not the mask overlay", () => {
    expect(resolveScanVolumeIndex(2, 1)).toBe(0);
    expect(resolveScanVolumeIndex(2, 0)).toBe(1);
    expect(resolveScanVolumeIndex(1, -1)).toBe(0);
    expect(resolveOverlayVolumeIndex(2, -1)).toBe(1);
    expect(resolveOverlayVolumeIndex(1, -1)).toBe(-1);
  });
});

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
    const { scan, nv, result } = setup(1);
    act(() => result.current.syncFromVolumes(nv));
    expect(scan.renderOpacity).toBeUndefined();
  });

  it("leaves the choice alone when the scan's own checkbox hides it everywhere", () => {
    const { result, nv } = setup();
    act(() => result.current.setScanIn3d(true));
    act(() => result.current.handleVolumeVisibilityToggle(0));
    expect(nv.setVolume).toHaveBeenCalledWith(0, { opacity: 0 });
    expect(result.current.scanIn3d).toBe(true);
  });

  it("carries the choice over to a newly loaded scan", () => {
    const { result, nv } = setup();
    const fresh: { renderOpacity?: number; opacity: number; name: string } = {
      opacity: 1,
      name: "scan",
    };
    nv.volumes[0] = fresh as unknown as NiiVueGPU["volumes"][number];
    act(() => result.current.syncFromVolumes(nv));
    expect(fresh.renderOpacity).toBe(0);
  });
});

describe("useVolumeDisplayControls per-layer opacity", () => {
  it("writes opacity only to the requested volume index", () => {
    const { result, nv } = setup();
    act(() => result.current.handleOpacityChange(1, 0.25));
    expect(nv.setVolume).toHaveBeenCalledWith(1, { opacity: 0.25 });
    expect(result.current.volumeOpacities[1]).toBe(0.25);
    expect(result.current.volumeOpacities[0]).toBe(1);
  });

  it("does not change a hidden volume's opacity", () => {
    const { result, nv } = setup();
    act(() => result.current.handleVolumeVisibilityToggle(1));
    vi.mocked(nv.setVolume).mockClear();
    act(() => result.current.handleOpacityChange(1, 0.8));
    expect(nv.setVolume).not.toHaveBeenCalled();
    expect(result.current.volumeOpacities[1]).toBe(0.5);
  });
});
