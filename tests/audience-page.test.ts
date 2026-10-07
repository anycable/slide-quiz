import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const page = readFileSync(resolve("packages/slidev-addon-slide-quiz/public/quiz.html"), "utf8");

describe("audience page endpoints", () => {
  const source = page.match(/const samePath = \(v\) => \{[\s\S]*?\n {4}\};/);
  const samePath = new Function("location", `${source?.[0]}; return samePath`)({
    origin: "https://slides.example.com",
  }) as (v: string | null) => string | undefined;

  it("accepts same-origin paths and URLs", () => {
    expect(samePath("/api/quiz-answer")).toBe("/api/quiz-answer");
    expect(samePath("https://slides.example.com/.netlify/functions/quiz-sync")).toBe("/.netlify/functions/quiz-sync");
  });

  it("rejects anything the browser would send to another origin", () => {
    for (const crafted of ["/\\evil.example/x", "//evil.example/x", "https://evil.example/x", "javascript:alert(1)", null]) {
      expect(samePath(crafted)).toBeUndefined();
    }
  });
});

describe("serverless functions", () => {
  for (const file of ["functions/netlify/shared.mts", "functions/vercel/shared.ts"]) {
    it(`${file} keeps the broadcast URL out of the public error`, () => {
      const source = readFileSync(resolve(file), "utf8");
      const message = source.slice(source.indexOf("export const BROADCAST_FAILED"), source.indexOf(";", source.indexOf("export const BROADCAST_FAILED")));
      expect(message).not.toMatch(/broadcastURL/);
    });
  }
});
