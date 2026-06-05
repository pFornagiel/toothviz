import { ClientStepName, type LoadingStepId } from "@/api/types";
import type { UploadPayload } from "./types";

export function createLoadingSteps(payload: UploadPayload): LoadingStepId[] {
  const hasMask = !!payload.segmentationFile;
  const uploadPrefix = hasMask
    ? [ClientStepName.UploadVolume, ClientStepName.UploadMask, ClientStepName.FinalizeUpload]
    : [ClientStepName.UploadVolume, ClientStepName.FinalizeUpload];
  const pipelineNames = payload.pipelines.map((p) => p.name);
  return [...uploadPrefix, ...pipelineNames];
}
