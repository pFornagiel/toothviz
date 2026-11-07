import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MeasurementList } from "@/app/visualization/components/MeasurementList";
import { SliceTypeKey } from "@/app/visualization/constants";
import type { MeasurementControls } from "@/app/visualization/hooks/useNiivueMeasurement";

function setup() {
  const measure = {
    measurements: [
      { distance: 26.449, plane: SliceTypeKey.Axial },
      { distance: 13.19, plane: SliceTypeKey.Sagittal },
      { distance: 5, plane: null },
    ],
    goTo: vi.fn(),
    remove: vi.fn(),
  } as unknown as MeasurementControls;
  render(<MeasurementList measure={measure} />);
  return measure;
}

afterEach(cleanup);

describe("MeasurementList", () => {
  it("shows each value with its plane", () => {
    setup();
    expect(screen.getByRole("button", { name: /26\.4 mm\s*Axial/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /13\.2 mm\s*Sagittal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5.0 mm" })).toBeInTheDocument();
  });

  it("goes to the clicked measurement", () => {
    const measure = setup();
    fireEvent.click(screen.getByRole("button", { name: /13\.2 mm/ }));
    expect(measure.goTo).toHaveBeenCalledWith(1);
    expect(measure.remove).not.toHaveBeenCalled();
  });

  it("removes only through the cross", () => {
    const measure = setup();
    fireEvent.click(screen.getByRole("button", { name: "Remove measurement 2" }));
    expect(measure.remove).toHaveBeenCalledWith(1);
    expect(measure.goTo).not.toHaveBeenCalled();
  });
});
