import {
  ClientStepName,
  PipelineStepName,
  UploadKind,
  type PipelineRequestItem,
} from "@/api/types";
import { IS_DEV } from "@/api/env";
import { validateNiftiFile } from "../utils/medicalFileTypes";
import type { UploadJob, UploadPayload } from "./types";

export enum FileType {
  Nifti = "nifti",
  Dicom = "dicom",
}

export enum SegmentationType {
  None = "none",
  Precomputed = "precomputed",
  Automated = "automated",
  TestingStub = "testing_stub",
}

export enum MaskInput {
  None = "none",
  Required = "required",
}

export interface StudyMode {
  key: SegmentationType;
  label: string;
  hint: string;
  maskInput: MaskInput;
  validateMask?: (file: File | null) => string | null;
  pipelines: PipelineRequestItem[];
}

export const STUDY_MODES = {
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
  // DEV only
  ...(IS_DEV && {
    [SegmentationType.TestingStub]: {
      key: SegmentationType.TestingStub,
      label: "TESTING: Stub pipeline",
      hint: "3x2s delays + passthrough, 4 steps",
      maskInput: MaskInput.None,
      pipelines: [
        { name: PipelineStepName.Stub },
        { name: PipelineStepName.Stub },
        { name: PipelineStepName.Stub },
        { name: PipelineStepName.Passthrough },
      ],
    },
  }),
} as Record<SegmentationType, StudyMode>;

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
