// electron-builder config for the self-contained installers, used by build.py
// in place of the "build" section of desktop/package.json. It packages the
// same Electron app, but ships the frozen backend (build/toothviz-backend)
// instead of the Python sources, so users need no Python, uv or Node.
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const application = path.join(repo, "packages/application");

// A real certificate is used when provided (see README). Without one, macOS
// builds are ad-hoc signed: Apple Silicon refuses to run unsigned code.
const macCertificate = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);

module.exports = {
  appId: "com.tooth.cbct",
  productName: "ToothViz",
  extraMetadata: {
    // Windows install folder (%LOCALAPPDATA%\Programs\toothviz) and Linux package name.
    name: "toothviz",
    // Electron names the user data folder (scans, database, logs) after this:
    // ~/.config/ToothViz, %APPDATA%\ToothViz, ~/Library/Application Support/ToothViz.
    productName: "ToothViz",
    // Shown in the Linux menu, package managers and Windows file properties.
    description: "Dental CBCT viewer with automatic tooth segmentation",
    homepage: "https://github.com/pFornagiel/toothviz",
    // Lets Linux taskbars match the window to its launcher icon.
    desktopName: "toothviz.desktop",
  },
  icon: path.join(application, "desktop/resources/icon.png"),
  directories: { output: path.join(__dirname, "release") },
  files: ["out/**/*", "resources/icon.png", "package.json"],
  // Chromium UI translations; dropping the other ~50 saves ~40 MB.
  electronLanguages: ["en-US", "pl"],
  extraResources: [
    { from: path.join(application, "frontend/dist"), to: "application/frontend/dist" },
    { from: path.join(__dirname, "build/toothviz-backend"), to: "backend" },
    {
      from: path.join(repo, "packages/models/lite_mobile_unet_5ch/exports"),
      to: "models",
      filter: ["*.onnx", "*.onnx.data", "*.json"],
    },
  ],

  win: {
    target: ["nsis"],
    artifactName: "ToothViz-Setup-${version}-windows-${arch}.${ext}",
  },
  nsis: {
    // Double-click, installs for the current user without an admin prompt,
    // adds Start menu + desktop shortcuts and starts the app.
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: "always",
    runAfterFinish: true,
  },

  mac: {
    category: "public.app-category.medical",
    target: ["dmg"],
    artifactName: "ToothViz-${version}-macos-${arch}.${ext}",
    identity: macCertificate ? undefined : "-",
    hardenedRuntime: macCertificate,
    entitlements: path.join(__dirname, "assets/entitlements.mac.plist"),
    entitlementsInherit: path.join(__dirname, "assets/entitlements.mac.plist"),
  },

  linux: {
    target: ["AppImage", "deb"],
    executableName: "toothviz",
    category: "Science",
    maintainer: "ToothViz Team <toothviz@users.noreply.github.com>",
    artifactName: "ToothViz-${version}-linux-${arch}.${ext}",
  },
  toolsets: {
    // Static AppImage runtime: runs without libfuse2, which Ubuntu 22.04+
    // no longer installs (the old runtime silently fails to start there).
    appimage: "1.0.3",
  },
};
