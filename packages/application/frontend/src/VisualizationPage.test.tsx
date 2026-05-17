import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { VisualizationPage } from "@/app/pages/VisualizationPage";

const mockLoadVolumes = vi.fn().mockResolvedValue(undefined);

vi.mock("@niivue/niivue", () => ({
  Niivue: vi.fn().mockImplementation(() => ({
    attachToCanvas: vi.fn(),
    loadVolumes: mockLoadVolumes,
    addVolumeFromUrl: vi.fn().mockResolvedValue(undefined),
    sliceTypeMultiplanar: 0,
    sliceTypeAxial: 1,
    sliceTypeCoronal: 2,
    sliceTypeSagittal: 3,
    sliceTypeRender: 4,
    setSliceType: vi.fn(),
    setMultiplanarLayout: vi.fn(),
    close: vi.fn(),
    volumes: [],
    setOpacity: vi.fn(),
  })),
}));

const getStudyMock = vi.fn();
const listFilesMock = vi.fn();

vi.mock("@/api/studies", () => ({
  getStudy: (...args: unknown[]) => getStudyMock(...args),
  listFiles: (...args: unknown[]) => listFilesMock(...args),
  fileContentUrl: vi.fn(() => "/mock/content"),
}));

vi.mock("@/api/ws", () => ({
  connectPipeline: vi.fn(() => () => {}),
}));

describe("VisualizationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadVolumes.mockClear();
    listFilesMock.mockReset();
    listFilesMock.mockResolvedValue([
      {
        id: "f1",
        study_id: "s1",
        kind: null,
        viewer_purpose: "viewer_volume",
        display_name: "volume.nii",
        blob_hash: "hash",
        size: 123,
        created_at: "2025-01-01T00:00:00Z",
        status: "ready",
      },
    ]);
  });

  it("loads viewer volumes when study has persisted files", async () => {
    getStudyMock.mockResolvedValue({
      id: "s1",
      name: "Test",
      status: "ready",
      created_at: "2025-01-01T00:00:00Z",
    });

    render(
      <MemoryRouter initialEntries={["/visualize/s1"]}>
        <Routes>
          <Route path="/visualize/:studyId?" element={<VisualizationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockLoadVolumes).toHaveBeenCalled();
    });
  });
});
