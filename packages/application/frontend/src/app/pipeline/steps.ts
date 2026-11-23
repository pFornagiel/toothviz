import {
  BackendStepName,
  ClientStepName,
  UploadKind,
  type LoadingStepId,
} from "@/api/types";
import type { UploadPayload } from "./types";
 
export function createUploadPrefixSteps(payload: UploadPayload): LoadingStepId[] {
  return [
    ...payload.uploads.map((u) => u.stepId),
    ClientStepName.FinalizeUpload,
  ];
}
 
export function expectedServerSteps(payload: UploadPayload): LoadingStepId[] {
  const auto: LoadingStepId[] = [];
  if (payload.uploads.some((u) => u.kind === UploadKind.DicomZip)) {
    auto.push(BackendStepName.DicomToNifti);
  }
  return [...auto, ...payload.pipelines.map((p) => p.name)];
}
 
export function createLoadingSteps(payload: UploadPayload): LoadingStepId[] {
  return [...createUploadPrefixSteps(payload), ...expectedServerSteps(payload)];
}
 