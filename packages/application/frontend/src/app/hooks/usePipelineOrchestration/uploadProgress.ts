import type { Dispatch } from "react";
import type { UploadProgress } from "@/api/upload";
import { PipelineActionType, type PipelineAction } from "./reducer";

// ---------------------------------------------------------------------------
// Upload progress handler — de-curried. All arithmetic lives in the reducer;
// the handler only guards on cancellation and dispatches a single event.
// ---------------------------------------------------------------------------

export function makeUploadProgressHandler(
  dispatch: Dispatch<PipelineAction>,
  isCancelled: () => boolean,
) {
  return function makeHandler(
    uploadStepIdx: number,
    finalizeStepIdx: number | null,
    volumeFinalizeOnSameStep: boolean,
  ): (p: UploadProgress) => void {
    return (p: UploadProgress) => {
      if (isCancelled()) return;
      dispatch({
        type: PipelineActionType.UploadProgress,
        upload: p,
        uploadStepIdx,
        finalizeStepIdx,
        volumeFinalizeOnSameStep,
      });
    };
  };
}
