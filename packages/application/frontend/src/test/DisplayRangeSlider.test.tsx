import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/app/components/ui/tooltip";
import DisplayRangeSlider from "@/app/visualization/components/DisplayRangeSlider";

function setup(lower: number, upper: number) {
  const onLowerChange = vi.fn();
  const onUpperChange = vi.fn();
  render(
    <TooltipProvider>
      <DisplayRangeSlider
        lower={lower}
        upper={upper}
        min={-1000}
        max={3000}
        onLowerChange={onLowerChange}
        onUpperChange={onUpperChange}
      />
    </TooltipProvider>,
  );
  const press = (handle: string, key: string) => {
    const thumb = screen.getByRole("slider", { name: handle });
    thumb.focus();
    fireEvent.keyDown(thumb, { key });
  };
  return { onLowerChange, onUpperChange, press };
}

afterEach(cleanup);

describe("DisplayRangeSlider", () => {
  it("shows both ends of the range", () => {
    setup(200, 1845);
    expect(screen.getByText("200 – 1845")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Lower limit" })).toHaveAttribute("aria-valuenow", "200");
    expect(screen.getByRole("slider", { name: "Upper limit" })).toHaveAttribute("aria-valuenow", "1845");
  });

  it("changes only the lower limit with the left handle", () => {
    const { onLowerChange, onUpperChange, press } = setup(200, 1845);
    press("Lower limit", "ArrowRight");
    expect(onLowerChange).toHaveBeenCalledWith(201);
    expect(onUpperChange).not.toHaveBeenCalled();
  });

  it("changes only the upper limit with the right handle", () => {
    const { onLowerChange, onUpperChange, press } = setup(200, 1845);
    press("Upper limit", "ArrowLeft");
    expect(onUpperChange).toHaveBeenCalledWith(1844);
    expect(onLowerChange).not.toHaveBeenCalled();
  });

  it("does not let the handles meet", () => {
    const { onLowerChange, onUpperChange, press } = setup(200, 201);
    press("Lower limit", "ArrowRight");
    press("Upper limit", "ArrowLeft");
    expect(onLowerChange).not.toHaveBeenCalled();
    expect(onUpperChange).not.toHaveBeenCalled();
  });
});
