import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { VisualizationPage } from "@/app/pages/VisualizationPage";

const mockLoadVolumes = vi.fn().mockResolvedValue(undefined);

// Plain-object mock: the page assigns flat properties (sliceType, azimuth,
// scaleMultiplier, ...) directly, which plain objects absorb without setup.
const makeNvMock = () => ({
  attachToCanvas: vi.fn().mockResolvedValue(undefined),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  loadVolumes: mockLoadVolumes,
  addVolume: vi.fn().mockResolvedValue(undefined),
  setVolume: vi.fn().mockResolvedValue(undefined),
  setClipPlane: vi.fn(),
  drawScene: vi.fn(),
  updateGLVolume: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
  volumes: [],
  colormaps: ["Gray", "Red"],
});

vi.mock("@niivue/niivue/webgl2", () => ({
  default: vi.fn().mockImplementation(() => makeNvMock()),
  NiiVueGPU: vi.fn().mockImplementation(() => makeNvMock()),
}));

vi.mock("@niivue/niivue", () => ({
  SLICE_TYPE: { AXIAL: 0, CORONAL: 1, SAGITTAL: 2, MULTIPLANAR: 3, RENDER: 4 },
  MULTIPLANAR_TYPE: { AUTO: 0, COLUMN: 1, GRID: 2, ROW: 3 },
  SHOW_RENDER: { NEVER: 0, ALWAYS: 1, AUTO: 2 },
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
