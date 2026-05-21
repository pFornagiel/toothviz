---
name: Clinical Precision
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#424752'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#727783'
  outline-variant: '#c2c6d4'
  surface-tint: '#005db6'
  primary: '#00478d'
  on-primary: '#ffffff'
  primary-container: '#005eb8'
  on-primary-container: '#c8daff'
  inverse-primary: '#a9c7ff'
  secondary: '#585f66'
  on-secondary: '#ffffff'
  secondary-container: '#dce3eb'
  on-secondary-container: '#5e656c'
  tertiary: '#3e4853'
  on-tertiary: '#ffffff'
  tertiary-container: '#56606c'
  on-tertiary-container: '#d0dbe8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#a9c7ff'
  on-primary-fixed: '#001b3d'
  on-primary-fixed-variant: '#00468c'
  secondary-fixed: '#dce3eb'
  secondary-fixed-dim: '#c0c7cf'
  on-secondary-fixed: '#151c22'
  on-secondary-fixed-variant: '#40484e'
  tertiary-fixed: '#d9e3f1'
  tertiary-fixed-dim: '#bdc7d5'
  on-tertiary-fixed: '#121c26'
  on-tertiary-fixed-variant: '#3e4853'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
  sidebar-bg: '#ebf2fa'
  obsidian-text: '#1d2731'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-sm:
    fontFamily: jetbrainsMono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  margin-page: 2rem
  gutter-panel: 1.5rem
  stack-tight: 0.5rem
  stack-med: 1rem
  sidebar-width: 320px
  toolbar-height: 56px
---

## Brand & Style

This design system is engineered for high-stakes medical environments, specifically dental NIfTI visualization. The brand personality is **clinical, precise, and authoritative**, yet highly accessible to reduce cognitive load during complex diagnostic tasks. 

We employ a **Corporate / Modern** style with a leaning toward **Minimalism**. The interface prioritizes data clarity and image fidelity over decorative elements. By utilizing a "Paper & Ink" philosophy—where the background is a pristine, neutral light and the primary interaction points are rendered in clinical blues—we evoke the sterility and professionalism of a modern dental clinic. The emotional response should be one of "calm focus" and "technological reliability."

## Colors

The palette is anchored in **Clinical Blues** and **Sterile Whites**. 

- **Primary (#005EB8):** A deep, trustworthy medical blue used for primary actions, active states, and critical indicators.
- **Secondary (#EBF2FA):** A soft, "Ice Blue" used for subtle backgrounds, hover states, and to differentiate sidebars from the main workspace.
- **Tertiary (#1D2731):** An "Obsidian Blue" reserved for high-contrast text and iconography to ensure AAA accessibility.
- **Neutral (#F8FAFC):** The foundational "Paper" color for the main background, providing a clean canvas for medical scans.

Backgrounds for the NIfTI viewer itself remain pitch black to ensure the full dynamic range of grayscale voxel data is preserved, while the surrounding UI provides a stark, clean contrast.

## Typography

We use **Inter** for its exceptional legibility at small sizes and its neutral, systematic feel. It scales perfectly from dense data tables to prominent section headers.

- **Headlines:** Use a tighter letter-spacing and semi-bold weight to establish clear hierarchy.
- **Data Labels:** Use `label-sm` with slight tracking and uppercase styling for table headers and metadata categories, referencing the structure in the provided study browser.
- **Monospaced:** **JetBrains Mono** is introduced for technical metadata, coordinates, and file paths (e.g., .nii.gz filenames) to differentiate system data from user-entered content.

## Layout & Spacing

The layout utilizes a **Fixed Sidebar / Fluid Workspace** model. 

- **Sidebar:** A 320px fixed-width panel on the left (or right) houses the "NiiVue Controls," using a light secondary background (#EBF2FA) to visually separate control logic from the viewport.
- **Grid:** Content within modals and study browsers follows a 12-column grid. Table rows in the "Browse Studies" view use generous 1rem vertical padding to prevent mis-clicks.
- **Density:** Spacing is "Comfortable" rather than "Compact." High-stakes medical decisions benefit from breathing room to avoid visual fatigue.

## Elevation & Depth

To maintain a "Clinical" feel, we avoid heavy shadows. Instead, we use:

- **Tonal Layering:** The main app background is `#FFFFFF`, while the sidebar and secondary panels use `#F8FAFC`.
- **Low-Contrast Outlines:** Surfaces are defined by 1px borders in `#E2E8F0`.
- **Modals:** Use a large-radius, extra-diffused shadow (0 20px 25px -5px rgba(0, 94, 184, 0.1)) to create a "floating" effect without feeling heavy.
- **Active State:** Elements that are "selected" (like a chosen study row) use a 2px left-border accent in the Primary color.

## Shapes

We use **Soft (0.25rem)** roundedness. This provides a professional, "tooled" look that feels more modern than sharp corners but more serious than highly rounded "consumer" apps. 

- **Buttons & Inputs:** Use the standard 0.25rem (4px) radius.
- **Cards & Modals:** Use `rounded-lg` (0.5rem) to soften large surface areas.
- **NIfTI Viewports:** Maintain sharp (0px) corners for the actual scan data to maximize the viewing area and respect the mathematical nature of the data grids.

## Components

- **Buttons:** Primary buttons are solid `#005EB8` with white text. Secondary buttons use a transparent background with a primary blue border.
- **NIfTI Viewports:** Contained within 1px bordered frames. Each quadrant (Axial, Sagittal, Coronal, 3D) should have a small, semi-transparent label in the top-left corner.
- **Control Sliders:** Use a Primary blue track with a white circular thumb containing a subtle shadow. Value readouts (e.g., "Opacity: 1.00") should be placed directly above the slider.
- **Lists & Tables:** Use alternating row highlights or subtle dividers. Action menus (three-dot) should open a clean white popover with high-contrast text.
- **Drop Zones:** For file uploads, use a dashed 1px Primary blue border with a light blue (#EBF2FA) tint on hover.
- **Checkboxes/Radios:** Custom-styled to use the Primary blue. Radio groups for "Segmentation Method" should be contained within clear vertical stacks with 0.5rem spacing.