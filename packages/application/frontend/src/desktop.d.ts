export interface DesktopBridge {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
