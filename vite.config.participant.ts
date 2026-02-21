import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "participant/index.ts",
      name: "LiveQuizParticipant",
      formats: ["es", "umd"],
      fileName: (format) =>
        `participant.${format === "es" ? "js" : "umd.js"}`,
    },
    rollupOptions: {
      output: {
        assetFileNames: (info) => {
          if (info.name?.endsWith(".css")) return "participant.css";
          return info.name ?? "asset";
        },
      },
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
