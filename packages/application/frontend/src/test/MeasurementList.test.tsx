import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MeasurementList } from "@/app/visualization/components/MeasurementList";
import { SliceTypeKey } from "@/app/visualization/constants";
import type { MeasurementControls } from "@/app/visualization/hooks/useNiivueMeasurement";

function setup(overrides: Partial<MeasurementControls> = {}) {
  const measure = {
    measurements: [
      { distance: 26.449, plane: SliceTypeKey.Axial, name: "Crown width" },
      { distance: 13.19, plane: SliceTypeKey.Sagittal, name: "" },
      { distance: 5, plane: null, name: "" },
    ],
    pendingRenameIndex: null,
    goTo: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    clearPendingRename: vi.fn(),
    ...overrides,
  } as unknown as MeasurementControls;
  render(<MeasurementList measure={measure} />);
  return { measure };
}

afterEach(cleanup);

describe("MeasurementList", () => {
  it("shows the name or a default label with the value", () => {
    setup();
    expect(screen.getByRole("button", { name: "Crown width" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /26\.4 mm\s*Axial/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Measurement 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /13\.2 mm\s*Sagittal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Measurement 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5.0 mm" })).toBeInTheDocument();
  });

  it("goes to the clicked measurement", () => {
    const { measure } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Measurement 2" }));
    expect(measure.goTo).toHaveBeenCalledWith(1);
    expect(measure.remove).not.toHaveBeenCalled();
  });

  it("keeps the value visible while renaming", () => {
    setup({
      measurements: [{ distance: 12.5, plane: SliceTypeKey.Coronal, name: "" }],
      pendingRenameIndex: 0,
    });
    expect(screen.getByRole("textbox", { name: "Name of measurement 1" })).toHaveValue(
      "Measurement 1",
    );
    expect(screen.getByText("12.5 mm")).toBeInTheDocument();
    expect(screen.getByText("Coronal")).toBeInTheDocument();
  });

  it("renames through the pencil and keeps a typed name", () => {
    const { measure } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Rename measurement 1" }));
    const input = screen.getByRole("textbox", { name: "Name of measurement 1" });
    fireEvent.change(input, { target: { value: "Mesial-distal" } });
    fireEvent.blur(input);
    expect(measure.rename).toHaveBeenCalledWith(0, "Mesial-distal");
  });

  it("Enter keeps the default name", () => {
    const { measure } = setup({
      measurements: [{ distance: 12, plane: SliceTypeKey.Coronal, name: "" }],
      pendingRenameIndex: 0,
    });
    const input = screen.getByRole("textbox", { name: "Name of measurement 1" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(measure.rename).toHaveBeenCalledWith(0, "Measurement 1");
  });

  it("opens rename on double-click", () => {
    setup();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Crown width" }));
    expect(screen.getByRole("textbox", { name: "Name of measurement 1" })).toHaveValue(
      "Crown width",
    );
  });

  it("removes only through the cross", () => {
    const { measure } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Remove measurement 2" }));
    expect(measure.remove).toHaveBeenCalledWith(1);
    expect(measure.goTo).not.toHaveBeenCalled();
  });
});
