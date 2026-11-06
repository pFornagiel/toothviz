/** Converts a `#rrggbb` colour to NiiVue's normalised RGBA (fully opaque). */
export const hexToRgba = (hex: string): [number, number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
  1,
];
