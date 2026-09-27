import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths, so the build runs from any sub-path or static host.
  base: "./",
  plugins: [react()],
});
