export interface DesktopBridge {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  /** Local backend origin chosen at startup, e.g. http://127.0.0.1:54321. */
  backendBaseUrl: string;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
