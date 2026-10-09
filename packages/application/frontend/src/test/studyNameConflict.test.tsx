import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "@/api/client";
import { CreateStudyModal } from "@/app/components/CreateStudyModal";
import { EditStudyModal } from "@/app/components/EditStudyModal";
import type { StudyResponse } from "@/api/types";

const mockRenameStudy = vi.fn();

vi.mock("@/api/studies", () => ({
  renameStudy: (...args: unknown[]) => mockRenameStudy(...args),
}));

const CONFLICT = 'A scan named "Taken" already exists.';

function selectBaseImage() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("file input not found");
  }
  const file = new File(["data"], "scan.nii.gz");
  fireEvent.change(input, { target: { files: [file] } });
}

describe("CreateStudyModal name conflict", () => {
  it("keeps the dialog open and shows the conflict under the name field", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, CONFLICT));
    render(<CreateStudyModal isOpen onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Scan Identifier"), { target: { value: "Taken" } });
    selectBaseImage();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(CONFLICT);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ studyName: "Taken" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan Identifier")).toHaveAttribute("aria-invalid", "true");
    // Selected file survives the failed attempt so the user only fixes the name.
    expect(screen.getByText("scan.nii.gz")).toBeInTheDocument();
  });

  it("clears the conflict once the name is edited", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, CONFLICT));
    render(<CreateStudyModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Scan Identifier"), { target: { value: "Taken" } });
    selectBaseImage();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await screen.findByRole("alert");

    fireEvent.change(screen.getByLabelText("Scan Identifier"), { target: { value: "Free" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EditStudyModal name conflict", () => {
  const study: StudyResponse = {
    id: "s1",
    name: "Mine",
    created_at: "2026-01-01T00:00:00Z",
    status: "ready",
  } as StudyResponse;

  beforeEach(() => {
    mockRenameStudy.mockReset();
  });

  it("keeps the dialog open and shows the conflict on rename", async () => {
    mockRenameStudy.mockRejectedValue(new ApiError(409, CONFLICT));
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <EditStudyModal
        study={study}
        isOpen
        onClose={onClose}
        onSave={onSave}
        onRequestDelete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Scan Identifier"), { target: { value: "Taken" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(CONFLICT);
    expect(mockRenameStudy).toHaveBeenCalledWith("s1", "Taken");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after a successful rename", async () => {
    mockRenameStudy.mockResolvedValue({ ...study, name: "Free" });
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <EditStudyModal
        study={study}
        isOpen
        onClose={onClose}
        onSave={onSave}
        onRequestDelete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Scan Identifier"), { target: { value: "Free" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalled();
  });
});
