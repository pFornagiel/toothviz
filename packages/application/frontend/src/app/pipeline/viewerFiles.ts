import type { FileRecordResponse } from "@/api/types";
import { ViewerPurpose } from "@/api/types";

export interface ViewerFileIds {
  volumeFileId?: string;
  overlayFileId?: string;
  volumeDisplayName?: string;
  overlayDisplayName?: string;
}

type ListFilesFn = (
  studyId: string,
  viewerPurpose?: string,
) => Promise<FileRecordResponse[]>;

/**
 * Resolve viewer purposes used by the NiiVue page (volume + optional overlay).
 * Prefer callers' known ids; fill gaps from listFiles.
 */
export async function resolveViewerFileIds(
  listFiles: ListFilesFn,
  studyId: string,
  known: {
    volumeFileId?: string | null;
    overlayFileId?: string | null;
    /** When false, never look up or return an overlay id. Default true. */
    includeOverlay?: boolean;
  } = {},
): Promise<ViewerFileIds> {
  const includeOverlay = known.includeOverlay !== false;
  let volumeFileId = known.volumeFileId ?? undefined;
  let overlayFileId = includeOverlay ? (known.overlayFileId ?? undefined) : undefined;
  let volumeDisplayName: string | undefined;
  let overlayDisplayName: string | undefined;

  const needVolume = volumeFileId == null;
  const needOverlay = includeOverlay && overlayFileId == null;
  if (!needVolume && !needOverlay) {
    return { volumeFileId, overlayFileId };
  }

  const purposes = [
    needVolume ? ViewerPurpose.Volume : null,
    needOverlay ? ViewerPurpose.Overlay : null,
  ]
    .filter(Boolean)
    .join(",");

  const files = await listFiles(studyId, purposes);
  if (needVolume) {
    const volume = files.find((f) => f.viewer_purpose === ViewerPurpose.Volume);
    volumeFileId = volume?.id;
    volumeDisplayName = volume?.display_name ?? undefined;
  }
  if (needOverlay) {
    const overlay = files.find((f) => f.viewer_purpose === ViewerPurpose.Overlay);
    overlayFileId = overlay?.id;
    overlayDisplayName = overlay?.display_name ?? undefined;
  }

  return { volumeFileId, overlayFileId, volumeDisplayName, overlayDisplayName };
}

/**
 * Resolve a volume file id for mid-pipeline preview (known id or listFiles).
 */
export async function resolveVolumePreviewId(
  listFiles: ListFilesFn,
  studyId: string,
  knownId?: string | null,
): Promise<string | undefined> {
  if (knownId) {
    return knownId;
  }
  const { volumeFileId } = await resolveViewerFileIds(listFiles, studyId, {
    includeOverlay: false,
  });
  return volumeFileId;
}
