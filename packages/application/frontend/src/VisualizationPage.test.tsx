import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { VisualizationPage } from "@/app/pages/VisualizationPage";

const mockLoadVolumes = vi.fn().mockResolvedValue(undefined);

vi.mock("@niivue/niivue", () => ({
  Niivue: vi.fn().mockImplementation(() => ({
    attachToCanvas: vi.fn(),
    loadVolumes: mockLoadVolumes,
    close: vi.fn(),
    volumes: [],
    setOpacity: vi.fn(),
  })),
}));

const getStudyMock = vi.fn();
vi.mock("@/api/studies", () => ({
  getStudy: (...args: unknown[]) => getStudyMock(...args),
  listFiles: vi.fn(),
  fileContentUrl: vi.fn(() => "/mock/content"),
}));

vi.mock("@/api/ws", () => ({
  connectPipeline: vi.fn(() => () => {}),
}));

describe("VisualizationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadVolumes.mockClear();
  });

  it("shows processing state and does not load volumes until ready", async () => {
    getStudyMock.mockResolvedValue({
      id: "s1",
      name: "Test",
      status: "processing",
      created_at: "2025-01-01T00:00:00Z",
      job_id: "j1",
      steps: ["segment_nifti"],
    });

    render(
      <MemoryRouter initialEntries={["/visualize/s1"]}>
        <Routes>
          <Route path="/visualize/:studyId?" element={<VisualizationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Processing study")).toBeInTheDocument();
    });

    expect(mockLoadVolumes).not.toHaveBeenCalled();
  });
});
