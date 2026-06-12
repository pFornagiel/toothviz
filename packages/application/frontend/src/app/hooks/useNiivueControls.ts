import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type NiiVueGPU from "@niivue/niivue/webgl2";
import { SLICE_TYPE, MULTIPLANAR_TYPE, SHOW_RENDER } from "@niivue/niivue";
import useNiivueSyncedRotation from "./useNiivueSyncedRotation";
import { NvUpdateKey, type QueueNvUpdate } from "./useNvUpdateQueue";
import {
  SliceTypeKey,
  CLIP_DEPTH_EDGE,
  RENDER_ZOOM_RANGE,
  DEFAULT_COLORMAP,
  DEFAULT_VISIBLE_OPACITY,
  DEFAULT_BACK_COLOR_DARK,
  DEFAULT_BACK_COLOR_LIGHT,
  DEFAULT_SHOW_3D_CROSSHAIR,
  DEFAULT_CROSSHAIR_WIDTH,
} from "../pages/visualizationConstants";

const CAL_MIN_GLOBAL_VAL = -1000;
const CAL_MAX_GLOBAL_VAL = 3000;

const DEFAULT_SLICE_TYPE = SliceTypeKey.Multiplanar;
const HIDDEN_OPACITY = 0;

// Default initial values for clip plane / render controls
const DEFAULT_CLIP_PLANE_DEPTH = CLIP_DEPTH_EDGE; // start fully visible (nothing clipped)

const DEFAULT_RENDER_ZOOM = 1.0; // niivue scaleMultiplier default (1 = no zoom)

export interface NiivueControls {
  // View layout
  sliceType: SliceTypeKey;
  handleSliceTypeChange: (type: SliceTypeKey) => void;
  /** Slice types that include a 3D render tile and therefore expose render controls */
  showsRender: boolean;

  // Volumes
  selectedVolume: number;
  handleVolumeChange: (index: number) => void;
  volumeVisibility: boolean[];
  handleVolumeVisibilityToggle: (index: number) => void;

  // Display (active volume)
  opacity: number;
  handleOpacityChange: (value: number) => void;
  colormap: string;
  colormaps: string[];
  handleColormapChange: (value: string) => void;
  cal_min: number;
  cal_max: number;
  cal_minGlobal: number;
  cal_maxGlobal: number;
  handleCalMinChange: (value: number) => void;
  handleCalMaxChange: (value: number) => void;

  // Scene
  showCrosshair: boolean;
  handleCrosshairToggle: () => void;
  crosshairWidth: number;
  handleCrosshairWidthChange: (value: number) => void;
  lightBackground: boolean;
  handleBackgroundToggle: () => void;

  // Clip plane
  clipPlaneDepth: number;
  setClipPlaneDepth: Dispatch<SetStateAction<number>>;
  clipPlaneAzimuth: number;
  setClipPlaneAzimuth: Dispatch<SetStateAction<number>>;
  clipPlaneElevation: number;
  setClipPlaneElevation: Dispatch<SetStateAction<number>>;

  // Render view
  renderAzimuth: number;
  handleRenderAzimuthChange: (value: number) => void;
  renderElevation: number;
  handleRenderElevationChange: (value: number) => void;
  renderZoom: number;
  handleRenderZoomChange: (value: number) => void;
  setRenderZoom: Dispatch<SetStateAction<number>>;

  // Drag rotation
  dragRotate: (dx: number, dy: number) => void;

  resetSettings: () => void;

  // Bridges for useNiivueViewer (both identity-stable)
  /** Wires niivue → React callbacks on a freshly created instance. */
  configureNv: (nv: NiiVueGPU) => void;
  /** Post-load UI sync: mirrors the loaded volumes into control state. */
  syncFromVolumes: (nv: NiiVueGPU) => void;
}

/**
 * All control state for the visualization page plus the handlers that push it
 * into niivue. Pure state/handler hook: instance lifecycle and file loading
 * live in `useNiivueViewer`, which talks back to this hook only through the
 * stable `configureNv`/`syncFromVolumes` bridges.
 */
export default function useNiivueControls({
  nvRef,
  queueNvUpdate,
}: {
  nvRef: MutableRefObject<NiiVueGPU | null>;
  queueNvUpdate: QueueNvUpdate;
}): NiivueControls {
  const [sliceType, setSliceType] = useState<SliceTypeKey>(DEFAULT_SLICE_TYPE);

  // Slice types that include a 3D render tile and therefore expose render controls
  const showsRender =
    sliceType === SliceTypeKey.Render ||
    sliceType === SliceTypeKey.Multiplanar ||
    sliceType === SliceTypeKey.Multiplanar4View;

  const [lightBackground, setLightBackground] = useState(false);

  // Volume controls
  const [selectedVolume, setSelectedVolume] = useState(0);
  const [volumeVisibility, setVolumeVisibility] = useState<boolean[]>([]);
  const [volumeOpacities, setVolumeOpacities] = useState<number[]>([]);
  const [opacity, setOpacity] = useState(DEFAULT_VISIBLE_OPACITY);
  const [colormap, _setColormap] = useState(DEFAULT_COLORMAP);
  const [colormaps, setColormaps] = useState<string[]>([]);
  const [cal_min, _setCalMin] = useState(CAL_MIN_GLOBAL_VAL);
  const [cal_max, _setCalMax] = useState(CAL_MAX_GLOBAL_VAL);
  const [cal_minGlobal, _setCalMinGlobal] = useState(CAL_MIN_GLOBAL_VAL);
  const [cal_maxGlobal, _setCalMaxGlobal] = useState(CAL_MAX_GLOBAL_VAL);

  // Initialised cal_min and cal_max for reset
  const initialCalMin = useRef(CAL_MIN_GLOBAL_VAL);
  const initialCalMax = useRef(CAL_MAX_GLOBAL_VAL);

  // Crosshair and display settings
  const [showCrosshair, setShowCrosshair] = useState(DEFAULT_SHOW_3D_CROSSHAIR);
  const [crosshairWidth, setCrosshairWidth] = useState(DEFAULT_CROSSHAIR_WIDTH);

  // Clip plane settings
  const [clipPlaneDepth, setClipPlaneDepth] = useState(DEFAULT_CLIP_PLANE_DEPTH);
  const [clipPlaneAzimuth, setClipPlaneAzimuth] = useState(0);
  const [clipPlaneElevation, setClipPlaneElevation] = useState(0);

  // Render settings
  const {
    azimuth: renderAzimuth,
    elevation: renderElevation,
    attach: attachRotation,
    setRotation,
    dragRotate,
    resetRotation,
  } = useNiivueSyncedRotation(nvRef);
  const [renderZoom, setRenderZoom] = useState(DEFAULT_RENDER_ZOOM);

  const setCalMax = useCallback(
    (value: number | undefined, setInitial: boolean = false) => {
      if (Number.isNaN(value) || value === undefined) {
        _setCalMax(CAL_MAX_GLOBAL_VAL);
        if (setInitial) {
          initialCalMax.current = CAL_MAX_GLOBAL_VAL;
        }
        return;
      }
      if (value < cal_min) {
        _setCalMax(cal_min);
        if (setInitial) {
          initialCalMax.current = cal_min;
        }
        return;
      }
      _setCalMax(value);
      if (setInitial) {
        initialCalMax.current = value;
      }
    },
    [cal_min],
  );

  const setCalMin = useCallback(
    (value: number | undefined, setInitial: boolean = false) => {
      if (Number.isNaN(value) || value === undefined) {
        _setCalMin(CAL_MIN_GLOBAL_VAL);
        if (setInitial) {
          initialCalMin.current = CAL_MIN_GLOBAL_VAL;
        }
        return;
      }

      if (value > cal_max) {
        _setCalMin(cal_max);
        if (setInitial) {
          initialCalMin.current = cal_max;
        }
        return;
      }
      _setCalMin(value);
      if (setInitial) {
        initialCalMin.current = value;
      }
    },
    [cal_max],
  );

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    queueNvUpdate(NvUpdateKey.CalMin, () => {
      void nv.setVolume(selectedVolume, { calMin: cal_min });
    });
    // Deliberately omits selectedVolume: switching the active volume must not
    // push the previous volume's cal_min into the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal_min, queueNvUpdate]);

  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    queueNvUpdate(NvUpdateKey.CalMax, () => {
      void nv.setVolume(selectedVolume, { calMax: cal_max });
    });
    // Deliberately omits selectedVolume: switching the active volume must not
    // push the previous volume's cal_max into the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal_max, queueNvUpdate]);

  const setCalMinGlobal = (value: number | undefined) => {
    if (Number.isNaN(value) || value === undefined) {
      return CAL_MIN_GLOBAL_VAL;
    }
    _setCalMinGlobal(value);
  };

  const setCalMaxGlobal = (value: number | undefined) => {
    if (Number.isNaN(value) || value === undefined) {
      return CAL_MAX_GLOBAL_VAL;
    }
    _setCalMaxGlobal(value);
  };

  const setColormap = (value: string | undefined) => {
    _setColormap(value || DEFAULT_COLORMAP);
  };

  const resetSettings = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setCalMin(initialCalMin.current);
    setCalMax(initialCalMax.current);
    setOpacity(DEFAULT_VISIBLE_OPACITY);
    setColormap(DEFAULT_COLORMAP);
    setVolumeVisibility(nv.volumes.map(() => true));
    setVolumeOpacities(nv.volumes.map((v) => v.opacity ?? DEFAULT_VISIBLE_OPACITY));

    resetRotation();

    // reset render zoom
    queueNvUpdate(NvUpdateKey.RenderZoom, () => {
      nv.scaleMultiplier = DEFAULT_RENDER_ZOOM;
      setRenderZoom(DEFAULT_RENDER_ZOOM);
    });
  };

  const handleSliceTypeChange = (type: SliceTypeKey) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }
    setSliceType(type);

    switch (type) {
      case SliceTypeKey.Multiplanar:
        nv.sliceType = SLICE_TYPE.MULTIPLANAR;
        nv.multiplanarType = MULTIPLANAR_TYPE.AUTO;
        nv.showRender = SHOW_RENDER.AUTO;
        break;
      case SliceTypeKey.Multiplanar4View:
        nv.sliceType = SLICE_TYPE.MULTIPLANAR;
        nv.multiplanarType = MULTIPLANAR_TYPE.GRID;
        nv.showRender = SHOW_RENDER.ALWAYS;
        break;
      case SliceTypeKey.Axial:
        nv.sliceType = SLICE_TYPE.AXIAL;
        break;
      case SliceTypeKey.Coronal:
        nv.sliceType = SLICE_TYPE.CORONAL;
        break;
      case SliceTypeKey.Sagittal:
        nv.sliceType = SLICE_TYPE.SAGITTAL;
        break;
      case SliceTypeKey.Render:
        nv.sliceType = SLICE_TYPE.RENDER;
        break;
    }
  };

  const handleVolumeChange = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }

    setSelectedVolume(index);
    const vol = nv.volumes[index];
    setOpacity(vol.opacity ?? DEFAULT_VISIBLE_OPACITY);
    setColormap(vol.colormap);
    setCalMin(vol.calMin);
    setCalMax(vol.calMax);
  };

  const handleOpacityChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setOpacity(value);
    queueNvUpdate(NvUpdateKey.Opacity, () => nv.setVolume(selectedVolume, { opacity: value }));

    // Update stored opacity if volume is visible
    if (volumeVisibility[selectedVolume]) {
      const newOpacities = [...volumeOpacities];
      newOpacities[selectedVolume] = value;
      setVolumeOpacities(newOpacities);
    }
  };

  const handleColormapChange = (value: string) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setColormap(value);
    nv.setVolume(selectedVolume, { colormap: value });
  };

  const handleCalMinChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }
    setCalMin(value);
  };

  const handleCalMaxChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[selectedVolume]) {
      return;
    }

    setCalMax(value);
  };

  const handleCrosshairToggle = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const newValue = !showCrosshair;
    setShowCrosshair(newValue);
    nv.is3DCrosshairVisible = newValue;
  };

  const handleCrosshairWidthChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    setCrosshairWidth(value);
    nv.crosshairWidth = value;
  };

  const handleVolumeVisibilityToggle = (index: number) => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes[index]) {
      return;
    }

    const newVisibility = [...volumeVisibility];
    newVisibility[index] = !newVisibility[index];
    setVolumeVisibility(newVisibility);

    // Set opacity to 0 to hide, restore stored opacity to show
    if (newVisibility[index]) {
      // Restore the stored opacity
      const opacityToRestore = volumeOpacities[index] ?? DEFAULT_VISIBLE_OPACITY;
      void nv.setVolume(index, { opacity: opacityToRestore });
    } else {
      // Store current opacity before hiding
      const newOpacities = [...volumeOpacities];
      newOpacities[index] = nv.volumes[index].opacity ?? DEFAULT_VISIBLE_OPACITY;
      setVolumeOpacities(newOpacities);
      // Hide by setting opacity to 0
      void nv.setVolume(index, { opacity: HIDDEN_OPACITY });
    }
  };

  const handleBackgroundToggle = () => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const newValue = !lightBackground;
    setLightBackground(newValue);
    nv.backgroundColor = newValue ? DEFAULT_BACK_COLOR_LIGHT : DEFAULT_BACK_COLOR_DARK;
  };

  const handleClipPlaneChange = useCallback(() => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    queueNvUpdate(NvUpdateKey.ClipPlane, () =>
      nv.setClipPlane([clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipPlaneDepth, clipPlaneAzimuth, clipPlaneElevation, queueNvUpdate]);

  const handleRenderAzimuthChange = (value: number) => {
    setRotation(value, renderElevation);
  };

  const handleRenderElevationChange = (value: number) => {
    setRotation(renderAzimuth, value);
  };

  const handleRenderZoomChange = (value: number) => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    const clamped = Math.min(RENDER_ZOOM_RANGE.max, Math.max(RENDER_ZOOM_RANGE.min, value));
    setRenderZoom(clamped);
    queueNvUpdate(NvUpdateKey.RenderZoom, () => {
      nv.scaleMultiplier = clamped;
    });
  };

  useEffect(() => {
    handleClipPlaneChange();
  }, [handleClipPlaneChange]);

  useEffect(() => {
    // Update multiplanar layout when switching to multiplanar_4view
    const nv = nvRef.current;
    if (!nv) {
      return;
    }

    if (sliceType === SliceTypeKey.Multiplanar4View) {
      nv.multiplanarType = MULTIPLANAR_TYPE.GRID;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceType]);

  const configureNv = useCallback(
    (nv: NiiVueGPU) => {
      attachRotation(nv);
    },
    [attachRotation],
  );

  /**
   * Post-load UI sync, identity-stable via the latest-ref pattern: the
   * implementation closes over `setCalMin`/`setCalMax`, whose identities change
   * with every `cal_min`/`cal_max` move. If this callback's identity tracked
   * theirs, the loading effects in `useNiivueViewer` (which depend on it
   * transitively) would re-fire on every cal slider drag and reload the volumes.
   */
  const syncFromVolumesRef = useRef<(nv: NiiVueGPU) => void>(() => {});
  syncFromVolumesRef.current = (nv: NiiVueGPU) => {
    if (nv.volumes.length === 0) {
      return;
    }
    const vol = nv.volumes[0];
    setOpacity(vol.opacity ?? DEFAULT_VISIBLE_OPACITY);
    setColormap(vol.colormap);
    setCalMinGlobal(vol.globalMin);
    setCalMaxGlobal(vol.globalMax);
    setCalMin(vol.calMin, true);
    setCalMax(vol.calMax, true);
    // Initialize visibility and store opacities for all volumes
    setVolumeVisibility(nv.volumes.map(() => true));
    setVolumeOpacities(nv.volumes.map((v) => v.opacity ?? DEFAULT_VISIBLE_OPACITY));
    setColormaps(nv.colormaps);
  };
  const syncFromVolumes = useCallback((nv: NiiVueGPU) => syncFromVolumesRef.current(nv), []);

  return {
    sliceType,
    handleSliceTypeChange,
    showsRender,
    selectedVolume,
    handleVolumeChange,
    volumeVisibility,
    handleVolumeVisibilityToggle,
    opacity,
    handleOpacityChange,
    colormap,
    colormaps,
    handleColormapChange,
    cal_min,
    cal_max,
    cal_minGlobal,
    cal_maxGlobal,
    handleCalMinChange,
    handleCalMaxChange,
    showCrosshair,
    handleCrosshairToggle,
    crosshairWidth,
    handleCrosshairWidthChange,
    lightBackground,
    handleBackgroundToggle,
    clipPlaneDepth,
    setClipPlaneDepth,
    clipPlaneAzimuth,
    setClipPlaneAzimuth,
    clipPlaneElevation,
    setClipPlaneElevation,
    renderAzimuth,
    handleRenderAzimuthChange,
    renderElevation,
    handleRenderElevationChange,
    renderZoom,
    handleRenderZoomChange,
    setRenderZoom,
    dragRotate,
    resetSettings,
    configureNv,
    syncFromVolumes,
  };
}
