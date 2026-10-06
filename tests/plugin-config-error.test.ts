import { describe, it, expect, vi } from "vitest";
import { createPlugin } from "../src/plugin";

function fakeReveal(slideQuiz: unknown) {
  const root = document.createElement("div");
  root.innerHTML = `<section data-quiz-id="q1"></section><section data-quiz-results="q1"></section><section></section>`;
  return {
    root,
    api: {
      getConfig: () => ({ slideQuiz }),
      getRevealElement: () => root,
      on: vi.fn(),
      off: vi.fn(),
      sync: vi.fn(),
    },
  };
}

describe("Reveal.js plugin with an invalid config", () => {
  it("names the failing field and shows the error on every quiz slide", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root, api } = fakeReveal({ wsUrl: "wss://cable.example/cable" });
    await createPlugin().init(api);

    const boxes = root.querySelectorAll(".sq-config-error");
    expect(boxes).toHaveLength(2);
    expect(boxes[0].textContent).toContain("quizGroupId");
    expect(warn.mock.calls[0][0]).toContain("quizGroupId");
    warn.mockRestore();
  });
});
