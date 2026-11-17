import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app build. `vite build --mode devhook` reads `.env.devhook` and keeps the development hook.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
});
