import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "RevealLiveQuiz",
      formats: ["es", "umd"],
      fileName: (format) => `live-quiz.${format === "es" ? "js" : "umd.js"}`,
    },
    rollupOptions: {
      external: ["reveal.js"],
      output: {
        exports: "named",
        globals: {
          "reveal.js": "Reveal",
        },
        assetFileNames: (info) => {
          if (info.name?.endsWith(".css")) return "live-quiz.css";
          return info.name ?? "asset";
        },
      },
    },
  },
});
