import { defineConfig } from "vite";

export default defineConfig({
  define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
  build: {
    lib: {
      entry: "participant/index.ts",
      name: "SlideQuizParticipant",
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
