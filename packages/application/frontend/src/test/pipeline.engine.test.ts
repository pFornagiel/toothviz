import { describe, it, expect, vi } from "vitest";
import { PipelineEngine, type PipelineApi } from "@/app/pipeline/pipelineEngine";
import { PipelineActionType, FinishMode, type PipelineAction } from "@/app/pipeline/reducer";
import { FromPage } from "@/app/pipeline/types";
import { ApiError } from "@/api/client";
import {
  ClientStepName,
  UploadKind,
  PipelineStepName,
  type StudyResponse,
  type PipelineMessage,
} from "@/api/types";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeStudy(overrides: Partial<StudyResponse> = {}): StudyResponse {
  return {
    id: "s1",
    name: null,
    status: "processing",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const uploadPayload = {
  uploads: [
    {
      file: new File(["x"], "volume.nii"),
      kind: UploadKind.NiftiRaw,
      stepId: ClientStepName.UploadVolume,
      carriesPipelines: true,
    },
  ],
  pipelines: [{ name: PipelineStepName.SegmentNifti }],
};

const uploadPayloadWithMask = {
  uploads: [
    {
      file: new File(["x"], "volume.nii"),
      kind: UploadKind.NiftiRaw,
      stepId: ClientStepName.UploadVolume,
      carriesPipelines: true,
    },
    {
      file: new File(["m"], "mask.nii"),
      kind: UploadKind.NiftiMask,
      stepId: ClientStepName.UploadMask,
      carriesPipelines: false,
    },
  ],
  pipelines: [{ name: PipelineStepName.SegmentNifti }],
};

interface Ws {
  onMessage: (m: PipelineMessage) => void;
  onClose: () => void;
  disconnect: ReturnType<typeof vi.fn>;
}

function setup(apiOverrides: Partial<PipelineApi> = {}) {
  const actions: PipelineAction[] = [];
  const dispatch = vi.fn((a: PipelineAction) => {
    actions.push(a);
  });
  const onNavigateToViewer = vi.fn();
  const ws = {} as Ws;

  const api: PipelineApi = {
    getStudy: vi.fn(async () => makeStudy({ status: "ready" })),
    deleteStudy: vi.fn(async () => {}),
    uploadFile: vi.fn(async (_studyId, _file, _kind, _pipelines, onProgress) => {
      onProgress?.({ phase: "begin" });
      onProgress?.({ phase: "uploading", chunkIndex: 0, totalChunks: 1 });
      onProgress?.({ phase: "finalizing" });
      onProgress?.({ phase: "done" });
      return { file_id: "f1", job_id: "job1" };
    }),
    establishWebsocketConnection: vi.fn((_jobId, onMessage, onClose) => {
      ws.onMessage = onMessage;
      ws.onClose = onClose ?? (() => {});
      ws.disconnect = vi.fn();
      return ws.disconnect;
    }),
    ...apiOverrides,
  };

  const engine = new PipelineEngine({ dispatch, api, onNavigateToViewer });
  return { engine, api, actions, onNavigateToViewer, ws };
}

const findAction = <T extends PipelineActionType>(actions: PipelineAction[], type: T) =>
  actions.find((a) => a.type === type) as Extract<PipelineAction, { type: T }> | undefined;

describe("PipelineEngine - start routing", () => {
  it("routes a failed study straight to an error", () => {
    const { engine, actions } = setup();
    engine.start({
      studyId: "s1",
      study: makeStudy({ status: "failed", error: "it broke" }),
      routeState: {},
    });
    expect(actions).toHaveLength(1);
    const err = findAction(actions, PipelineActionType.SetError);
    expect(err?.error.title).toBe("Study is not available");
    expect(err?.error.message).toBe("it broke");
  });

  it("errors when there is no job and the study is not processing", () => {
    const { engine, actions } = setup();
    engine.start({
      studyId: "s1",
      study: makeStudy({ status: "queued", job_id: null }),
      routeState: {},
    });
    expect(findAction(actions, PipelineActionType.SetError)?.error.title).toBe(
      "Upload state was lost",
    );
  });

  it("navigates straight to the viewer when processing without a job id", () => {
    const { engine, onNavigateToViewer } = setup();
    engine.start({
      studyId: "s1",
      study: makeStudy({ status: "processing", job_id: null }),
      routeState: { from: FromPage.Browse },
    });
    expect(onNavigateToViewer).toHaveBeenCalledWith("s1", { from: FromPage.Browse });
  });
});

describe("PipelineEngine - upload flow", () => {
  it("uploads, globalises pipeline steps, and navigates on completion", async () => {
    const { engine, api, actions, onNavigateToViewer, ws } = setup();
    engine.start({
      studyId: "s1",
      study: makeStudy(),
      routeState: { uploadPayload, from: FromPage.Home },
    });
    await flush();

    expect(actions[0].type).toBe(PipelineActionType.Begin);
    // No-mask prefix length is 2, so the pipeline phase enters at step 2.
    expect(findAction(actions, PipelineActionType.EnterPipeline)?.stepIndex).toBe(2);
    // Upload's own finalize step (index 1) is marked complete.
    expect(
      actions.some((a) => a.type === PipelineActionType.CompleteStep && a.stepIndex === 1),
    ).toBe(true);
    expect(api.establishWebsocketConnection).toHaveBeenCalledTimes(1);

    // Pipeline step_completed is globalised by the upload offset (0 -> 2).
    ws.onMessage({
      event: "step_completed",
      step: "segment",
      progress: 1,
      total_steps: 1,
      step_index: 0,
    });
    expect(
      actions.some((a) => a.type === PipelineActionType.CompleteStep && a.stepIndex === 2),
    ).toBe(true);

    ws.onMessage({ event: "pipeline_completed", overlay_file_id: "mask-1" });
    expect(findAction(actions, PipelineActionType.Finish)?.mode).toBe(FinishMode.Completed);

    await flush();
    expect(onNavigateToViewer).toHaveBeenCalledWith("s1", {
      from: FromPage.Home,
      overlayFileId: "mask-1",
      volumeFileId: undefined,
    });
    expect(api.getStudy).not.toHaveBeenCalled();
  });

  it("uploads volume then mask, sharing the trailing finalize step", async () => {
    const { engine, api, actions, ws } = setup();
    engine.start({
      studyId: "s1",
      study: makeStudy(),
      routeState: { uploadPayload: uploadPayloadWithMask, from: FromPage.Home },
    });
    await flush();

    // Two uploads happened; only the volume (first) carried the pipelines.
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.uploadFile).mock.calls[0][3]).toEqual([
      { name: PipelineStepName.SegmentNifti },
    ]);
    expect(vi.mocked(api.uploadFile).mock.calls[1][3]).toEqual([]);
    expect(vi.mocked(api.uploadFile).mock.calls[1][2]).toBe(UploadKind.NiftiMask);

    // Volume finalizes in place on its own step (0); the mask owns the shared
    // finalize step (2). Pipeline then enters at the upload-prefix length (3).
    expect(
      actions.some((a) => a.type === PipelineActionType.CompleteStep && a.stepIndex === 0),
    ).toBe(true);
    expect(
      actions.some((a) => a.type === PipelineActionType.CompleteStep && a.stepIndex === 2),
    ).toBe(true);
    expect(findAction(actions, PipelineActionType.EnterPipeline)?.stepIndex).toBe(3);

    ws.onMessage({
      event: "step_completed",
      step: "segment",
      progress: 1,
      total_steps: 1,
      step_index: 0,
    });
    // Pipeline step globalised by the upload offset (0 -> 3).
    expect(
      actions.some((a) => a.type === PipelineActionType.CompleteStep && a.stepIndex === 3),
    ).toBe(true);
  });

  it("skips the pipeline and opens the viewer when finalize returns no job", async () => {
    const { engine, api, actions, onNavigateToViewer } = setup({
      uploadFile: vi.fn(async (_s, _f, _k, _p, onProgress) => {
        onProgress?.({ phase: "done" });
        return { file_id: "f1", job_id: null };
      }),
    });
    engine.start({
      studyId: "s1",
      study: makeStudy(),
      routeState: { uploadPayload, from: FromPage.Browse },
    });
    await flush();

    expect(api.establishWebsocketConnection).not.toHaveBeenCalled();
    expect(findAction(actions, PipelineActionType.Finish)?.mode).toBe(FinishMode.NoPipeline);
    expect(onNavigateToViewer).toHaveBeenCalledWith("s1", { from: FromPage.Browse });
  });

  it("deletes the study and surfaces an error when upload fails", async () => {
    const { engine, api, actions } = setup({
      uploadFile: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    engine.start({
      studyId: "s1",
      study: makeStudy(),
      routeState: { uploadPayload },
    });
    await flush();

    expect(api.deleteStudy).toHaveBeenCalledWith("s1");
    const err = findAction(actions, PipelineActionType.SetError);
    expect(err?.error.title).toBe("Upload failed");
    expect(err?.error.message).toBe("network down");
  });
});

describe("PipelineEngine - reconnect flow", () => {
  const reconnectApi = () => ({
    getStudy: vi.fn(async () =>
      makeStudy({ status: "processing", steps: [PipelineStepName.SegmentNifti] }),
    ),
  });

  it("adopts server steps, enters the pipeline at step 0, and connects", async () => {
    const { engine, api, actions } = setup(reconnectApi());
    engine.start({
      studyId: "s1",
      study: makeStudy({ job_id: "job1" }),
      routeState: {},
    });
    await flush();

    expect(findAction(actions, PipelineActionType.SetSteps)?.steps).toEqual([
      PipelineStepName.SegmentNifti,
    ]);
    expect(findAction(actions, PipelineActionType.EnterPipeline)?.stepIndex).toBe(0);
    expect(api.establishWebsocketConnection).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 404 from getStudy as 'Study not found'", async () => {
    const { engine, actions } = setup({
      getStudy: vi.fn(async () => {
        throw new ApiError(404, "gone");
      }),
    });
    engine.start({
      studyId: "s1",
      study: makeStudy({ job_id: "job1" }),
      routeState: {},
    });
    await flush();
    expect(findAction(actions, PipelineActionType.SetError)?.error.title).toBe("Study not found");
  });

  it("navigates without opening a socket when the study is already ready", async () => {
    const { engine, api, onNavigateToViewer } = setup({
      getStudy: vi.fn(async () => makeStudy({ status: "ready", job_id: "job1" })),
    });
    engine.start({
      studyId: "s1",
      study: makeStudy({ job_id: "job1" }),
      routeState: {},
    });
    await flush();

    expect(api.establishWebsocketConnection).not.toHaveBeenCalled();
    expect(onNavigateToViewer).toHaveBeenCalledWith("s1", { from: FromPage.Home });
  });

  it("reconnect() navigates when getStudy reports ready (missed completion frame)", async () => {
    const getStudy = vi
      .fn()
      .mockResolvedValueOnce(makeStudy({ status: "processing", steps: [PipelineStepName.SegmentNifti] }))
      .mockResolvedValueOnce(makeStudy({ status: "ready", job_id: "job1" }));

    const { engine, api, onNavigateToViewer, ws } = setup({ getStudy });
    engine.start({
      studyId: "s1",
      study: makeStudy({ job_id: "job1" }),
      routeState: {},
    });
    await flush();

    ws.onClose();
    engine.reconnect();
    await flush();

    expect(api.establishWebsocketConnection).toHaveBeenCalledTimes(1);
    expect(onNavigateToViewer).toHaveBeenCalledWith("s1", { from: FromPage.Home });
  });

  it("dispatches ConnectionClosed on socket close; reconnect() re-runs", async () => {
    const { engine, api, actions, ws } = setup(reconnectApi());
    engine.start({
      studyId: "s1",
      study: makeStudy({ job_id: "job1" }),
      routeState: {},
    });
    await flush();
    expect(api.establishWebsocketConnection).toHaveBeenCalledTimes(1);

    ws.onClose();
    expect(actions.some((a) => a.type === PipelineActionType.ConnectionClosed)).toBe(true);

    engine.reconnect();
    await flush();
    expect(actions.some((a) => a.type === PipelineActionType.ClearConnectionLost)).toBe(true);
    expect(api.establishWebsocketConnection).toHaveBeenCalledTimes(2);
  });

  it("ignores reconnect() while the socket is still connected", async () => {
    const { engine, api } = setup(reconnectApi());
    engine.start({
      studyId: "s1",
      study: makeStudy({ job_id: "job1" }),
      routeState: {},
    });
    await flush();
    expect(api.establishWebsocketConnection).toHaveBeenCalledTimes(1);

    engine.reconnect();
    await flush();
    expect(api.establishWebsocketConnection).toHaveBeenCalledTimes(1);
  });

  it("dispose() cancels work and tears down the socket", async () => {
    const { engine, ws } = setup(reconnectApi());
    engine.start({
      studyId: "s1",
      study: makeStudy({ job_id: "job1" }),
      routeState: {},
    });
    await flush();

    engine.dispose();
    expect(ws.disconnect).toHaveBeenCalledTimes(1);
  });
});
