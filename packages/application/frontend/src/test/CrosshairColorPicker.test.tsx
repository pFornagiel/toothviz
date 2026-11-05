import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CrosshairColorPicker } from "@/app/visualization/components/CrosshairColorPicker";

// An open Radix Popover blocks the jsdom worker for several seconds per test, so
// positioning is stubbed out here; only the open/close contract is kept.
vi.mock("@/app/components/ui/popover", () => {
  const Ctx = React.createContext({ open: false, toggle: () => {} });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) => (
      <Ctx.Provider value={{ open, toggle: () => onOpenChange(!open) }}>{children}</Ctx.Provider>
    ),
    PopoverTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) =>
      React.cloneElement(children, { onClick: React.useContext(Ctx).toggle }),
    PopoverContent: ({ children }: { children: React.ReactNode }) =>
      React.useContext(Ctx).open ? <div>{children}</div> : null,
  };
});

const openPalette = () => {
  fireEvent.click(screen.getByLabelText("Crosshair color", { selector: "button" }));
};

describe("CrosshairColorPicker", () => {
  it("marks the active colour and closes after a pick", () => {
    const onChange = vi.fn();
    render(<CrosshairColorPicker value="#ff0000" onChange={onChange} />);

    openPalette();
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(6);
    expect(screen.getByLabelText("Red").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByLabelText("Cyan"));
    expect(onChange).toHaveBeenCalledWith("#00e5ff");
    expect(screen.queryByLabelText("Cyan")).toBeNull();
  });

  it("closes without a change when the active colour is clicked again", () => {
    const onChange = vi.fn();
    render(<CrosshairColorPicker value="#ff0000" onChange={onChange} />);

    openPalette();
    fireEvent.click(screen.getByLabelText("Red"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Red")).toBeNull();
  });

  it("does not open while disabled", () => {
    render(<CrosshairColorPicker value="#ff0000" onChange={vi.fn()} disabled />);

    openPalette();
    expect(document.querySelector('[role="radio"]')).toBeNull();
  });
});
