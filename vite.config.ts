import { defineConfig } from "vite";

export default defineConfig({
  define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
  build: {
    lib: {
      entry: "src/index.ts",
      name: "RevealSlideQuiz",
      formats: ["es", "umd"],
      fileName: (format) => `slide-quiz.${format === "es" ? "js" : "umd.js"}`,
    },
    rollupOptions: {
      external: ["reveal.js"],
      output: {
        exports: "named",
        globals: {
          "reveal.js": "Reveal",
        },
        assetFileNames: (info) => {
          if (info.name?.endsWith(".css")) return "slide-quiz.css";
          return info.name ?? "asset";
        },
      },
    },
  },
});
