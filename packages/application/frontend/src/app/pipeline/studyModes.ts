// ---------------------------------------------------------------------------
// Study-mode registry — the single source of truth for the ways a study can be
// created. Each mode self-describes its label/hint, whether it's dev-only,
// whether it collects a mask file (and how to validate it), and the pipelines
// it requests. `CreateStudyModal` renders its radio options from this registry,
// and `StartPage` builds the `UploadPayload` from it, so adding a new mode is a
// data change in this one file.
// ---------------------------------------------------------------------------

import {
  ClientStepName,
  PipelineStepName,
  UploadKind,
  type PipelineRequestItem,
} from "@/api/types";
import { validateNiftiFile } from "../utils/medicalFileTypes";
import type { UploadJob, UploadPayload } from "./types";

/** How a study's base image is provided. */
export enum FileType {
  Nifti = "nifti",
  Dicom = "dicom",
}

/** Which segmentation strategy a study is created with. */
export enum SegmentationType {
  None = "none",
  Precomputed = "precomputed",
  Automated = "automated",
  TestingStub = "testing_stub",
}

/** Whether a mode collects a mask file from the user. */
export enum MaskInput {
  None = "none",
  Required = "required",
}

export interface StudyMode {
  key: SegmentationType;
  label: string;
  hint: string;
  devOnly?: boolean;
  maskInput: MaskInput;
  validateMask?: (file: File | null) => string | null;
  pipelines: PipelineRequestItem[];
}

export const STUDY_MODES: Record<SegmentationType, StudyMode> = {
  [SegmentationType.None]: {
    key: SegmentationType.None,
    label: "None",
    hint: "Raw visualization only",
    maskInput: MaskInput.None,
    pipelines: [],
  },
  [SegmentationType.Precomputed]: {
    key: SegmentationType.Precomputed,
    label: "Pre-computed Mask",
    hint: "Upload existing .nii.gz mask",
    maskInput: MaskInput.Required,
    validateMask: validateNiftiFile,
    pipelines: [],
  },
  [SegmentationType.Automated]: {
    key: SegmentationType.Automated,
    label: "Automated Deep Learning",
    hint: "Run inference via connected cluster",
    maskInput: MaskInput.None,
    pipelines: [{ name: PipelineStepName.SegmentNifti }],
  },
  [SegmentationType.TestingStub]: {
    key: SegmentationType.TestingStub,
    label: "TESTING: Stub pipeline",
    hint: "3×2s delays + passthrough, 4 steps",
    devOnly: true,
    maskInput: MaskInput.None,
    pipelines: [
      { name: PipelineStepName.Stub },
      { name: PipelineStepName.Stub },
      { name: PipelineStepName.Stub },
      { name: PipelineStepName.Passthrough },
    ],
  },
};

/** Shared N-upload builder: base volume (carries pipelines) + optional trailing mask. */
export function buildUploadPayload(
  base: { file: File; kind: UploadKind },
  mode: StudyMode,
  maskFile?: File,
): UploadPayload {
  const uploads: UploadJob[] = [
    {
      file: base.file,
      kind: base.kind,
      stepId: ClientStepName.UploadVolume,
      carriesPipelines: true,
    },
  ];

  if (mode.maskInput === MaskInput.Required && maskFile) {
    uploads.push({
      file: maskFile,
      kind: UploadKind.NiftiMask,
      stepId: ClientStepName.UploadMask,
      carriesPipelines: false,
    });
  }

  return { uploads, pipelines: mode.pipelines };
}
