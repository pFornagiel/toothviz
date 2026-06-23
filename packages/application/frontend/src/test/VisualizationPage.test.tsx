import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { VisualizationPage } from "@/app/pages/VisualizationPage";

const mockLoadVolumes = vi.fn().mockResolvedValue(undefined);

vi.mock("@niivue/niivue/webgl2", () => ({
  default: vi.fn().mockImplementation(() => ({
    attachToCanvas: vi.fn().mockResolvedValue(undefined),
    loadVolumes: mockLoadVolumes,
    addVolume: vi.fn().mockResolvedValue(undefined),
    sliceType: 0,
    multiplanarType: 0,
    showRender: 0,
    azimuth: 120,
    elevation: 10,
    scaleMultiplier: 1,
    is3DCrosshairVisible: true,
    crosshairWidth: 0.2,
    backgroundColor: [0, 0, 0, 1],
    devicePixelRatio: 1,
    colormaps: ["Gray", "Red", "Green"],
    volumes: [],
    setClipPlane: vi.fn(),
    setVolume: vi.fn(),
    destroy: vi.fn(),
    addEventListener: vi.fn(),
    view: null,
  })),
}));

vi.mock("@niivue/niivue", () => ({
  SLICE_TYPE: { MULTIPLANAR: 0, AXIAL: 1, CORONAL: 2, SAGITTAL: 3, RENDER: 4 },
  MULTIPLANAR_TYPE: { AUTO: 0, GRID: 2 },
  SHOW_RENDER: { AUTO: 0, ALWAYS: 1 },
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
