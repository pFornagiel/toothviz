import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const frontendRoot = path.resolve(__dirname, "../frontend");
const backendPort = process.env.TOOTH_BACKEND_PORT ?? "17890";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, "electron/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: frontendRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(frontendRoot, "src"),
      },
    },
    assetsInclude: ["**/*.svg", "**/*.csv"],
    server: {
      proxy: {
        "/storage": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
        },
        "/ws": {
          target: `ws://127.0.0.1:${backendPort}`,
          ws: true,
        },
      },
    },
    build: {
      outDir: path.resolve(frontendRoot, "dist"),
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(frontendRoot, "index.html"),
      },
    },
  },
});
