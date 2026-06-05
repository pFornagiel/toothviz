import { ClientStepName, type LoadingStepId } from "@/api/types";
import type { UploadPayload } from "./types";

export function createLoadingSteps(payload: UploadPayload): LoadingStepId[] {
  return [
    ...payload.uploads.map((u) => u.stepId),
    ClientStepName.FinalizeUpload,
    ...payload.pipelines.map((p) => p.name),
  ];
}
