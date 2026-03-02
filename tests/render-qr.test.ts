import { describe, it, expect, afterEach } from "vitest";
import { isLightBackground } from "../src/dom/render-qr";

describe("isLightBackground", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--r-background-color");
  });

  describe("element background", () => {
    it("detects light opaque background", () => {
      const el = document.createElement("div");
      el.style.backgroundColor = "rgb(255, 255, 255)";
      document.body.appendChild(el);
      expect(isLightBackground(el)).toBe(true);
      el.remove();
    });

    it("detects dark opaque background", () => {
      const el = document.createElement("div");
      el.style.backgroundColor = "rgb(30, 30, 30)";
      document.body.appendChild(el);
      expect(isLightBackground(el)).toBe(false);
      el.remove();
    });

    it("detects semi-transparent light background as light", () => {
      const el = document.createElement("div");
      el.style.backgroundColor = "rgba(255, 255, 255, 0.5)";
      document.body.appendChild(el);
      expect(isLightBackground(el)).toBe(true);
      el.remove();
    });

    it("detects semi-transparent dark background as dark", () => {
      const el = document.createElement("div");
      el.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
      document.body.appendChild(el);
      expect(isLightBackground(el)).toBe(false);
      el.remove();
    });

    it("skips fully transparent background and falls through to CSS variable", () => {
      document.documentElement.style.setProperty("--r-background-color", "#fff");
      const el = document.createElement("div");
      el.style.backgroundColor = "rgba(0, 0, 0, 0)";
      document.body.appendChild(el);
      // Transparent element should be ignored → fallback to --r-background-color: #fff → light
      expect(isLightBackground(el)).toBe(true);
      el.remove();
    });

    it("skips fully transparent background and falls through to dark CSS variable", () => {
      document.documentElement.style.setProperty("--r-background-color", "#222");
      const el = document.createElement("div");
      el.style.backgroundColor = "rgba(0, 0, 0, 0)";
      document.body.appendChild(el);
      expect(isLightBackground(el)).toBe(false);
      el.remove();
    });
  });

  describe("CSS variable fallback", () => {
    it("reads --r-background-color hex (#fff)", () => {
      document.documentElement.style.setProperty("--r-background-color", "#fff");
      expect(isLightBackground()).toBe(true);
    });

    it("reads --r-background-color hex (#1a1a1a)", () => {
      document.documentElement.style.setProperty("--r-background-color", "#1a1a1a");
      expect(isLightBackground()).toBe(false);
    });

    it("defaults to dark when no background info is available", () => {
      expect(isLightBackground()).toBe(false);
    });
  });
});
