import { ClientStepName, type LoadingStepId } from "@/api/types";
import type { UploadPayload } from "./types";



export function createLoadingSteps(payload: UploadPayload): LoadingStepId[] {
  const pipelineNames = payload.pipelines.map((p) => p.name);

  switch (!!payload.segmentationFile) {
    case true:
      return [
        ClientStepName.UploadVolume,
        ClientStepName.UploadMask,
        ClientStepName.FinalizeUpload,
        ...pipelineNames,
      ];
    case false:
      return [
        ClientStepName.UploadVolume,
        ClientStepName.FinalizeUpload,
        ...pipelineNames,
      ];
  }
}
