import { describe, expect, it, vi } from "vitest";
import { resolveViewerFileIds, resolveVolumePreviewId } from "../app/pipeline/viewerFiles";
import { watchStudyUntilTerminal } from "../app/pipeline/studyWatch";
import type { StudyResponse } from "@/api/types";

describe("resolveViewerFileIds", () => {
  it("fills missing volume and overlay from listFiles", async () => {
    const listFiles = vi.fn(async () => [
      {
        id: "v1",
        study_id: "s1",
        kind: "nifti_raw",
        viewer_purpose: "viewer_volume",
        display_name: "vol.nii",
        blob_hash: "a",
        size: 1,
        created_at: "",
        status: "ready",
      },
      {
        id: "o1",
        study_id: "s1",
        kind: "segmentation_mask",
        viewer_purpose: "viewer_overlay",
        display_name: "mask.nii",
        blob_hash: "b",
        size: 1,
        created_at: "",
        status: "ready",
      },
    ]);

    const resolved = await resolveViewerFileIds(listFiles, "s1");
    expect(resolved).toEqual({
      volumeFileId: "v1",
      overlayFileId: "o1",
      volumeDisplayName: "vol.nii",
      overlayDisplayName: "mask.nii",
    });
    expect(listFiles).toHaveBeenCalledWith("s1", "viewer_volume,viewer_overlay");
  });

  it("skips overlay lookup when includeOverlay is false", async () => {
    const listFiles = vi.fn(async () => [
      {
        id: "v1",
        study_id: "s1",
        kind: "nifti_raw",
        viewer_purpose: "viewer_volume",
        display_name: "vol.nii",
        blob_hash: "a",
        size: 1,
        created_at: "",
        status: "ready",
      },
    ]);

    const resolved = await resolveViewerFileIds(listFiles, "s1", { includeOverlay: false });
    expect(resolved.volumeFileId).toBe("v1");
    expect(resolved.overlayFileId).toBeUndefined();
    expect(listFiles).toHaveBeenCalledWith("s1", "viewer_volume");
  });
});

describe("resolveVolumePreviewId", () => {
  it("returns the known id without listing files", async () => {
    const listFiles = vi.fn(async () => []);
    await expect(resolveVolumePreviewId(listFiles, "s1", "known")).resolves.toBe("known");
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("lists viewer_volume when no known id", async () => {
    const listFiles = vi.fn(async () => [
      {
        id: "v1",
        study_id: "s1",
        kind: "nifti_raw",
        viewer_purpose: "viewer_volume",
        display_name: "vol.nii",
        blob_hash: "a",
        size: 1,
        created_at: "",
        status: "ready",
      },
    ]);
    await expect(resolveVolumePreviewId(listFiles, "s1")).resolves.toBe("v1");
    expect(listFiles).toHaveBeenCalledWith("s1", "viewer_volume");
  });
});

describe("watchStudyUntilTerminal", () => {
  it("stops polling after the first terminal status", async () => {
    vi.useFakeTimers();
    const getStudy = vi.fn(async () => ({ status: "ready" }) as StudyResponse);
    const onTerminal = vi.fn(async () => {});

    const stop = watchStudyUntilTerminal({
      getStudy,
      studyId: "s1",
      intervalMs: 1000,
      onTerminal,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onTerminal).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(getStudy.mock.calls.length).toBe(1);

    stop();
    vi.useRealTimers();
  });
});
