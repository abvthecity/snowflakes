import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { wgslVitePlugin } from "vgpu/client";

export default defineConfig({
  // Relative asset paths, so the build runs from any sub-path or static host.
  base: "./",
  // `.wgsl` imports resolve their module graph (and @vgpu/wgsl-std) at build time.
  plugins: [react(), wgslVitePlugin({ minify: true })],
});
