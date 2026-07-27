import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(rootDir, "build-temp"),
    emptyOutDir: true,
    lib: {
      entry: resolve(rootDir, "src/inpage/provider.ts"),
      name: "ThruShieldInpage",
      formats: ["iife"],
      fileName: () => "inpage.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  logLevel: "warn",
});
