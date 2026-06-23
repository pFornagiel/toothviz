import "@testing-library/jest-dom/vitest";

// Radix UI primitives (Slider, Select, ...) rely on ResizeObserver, which jsdom
// does not implement. Provide a no-op polyfill so components render under test.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserver as unknown as typeof globalThis.ResizeObserver;
}
