import { describe, it, expect } from "vitest";
import { questionHint } from "../src/dom/render-question";
import { displayUrl } from "../src/dom/render-qr";
import { MULTI_HINT } from "../src/quiz-types";

function slide(hint?: string): HTMLElement {
  const el = document.createElement("section");
  if (hint) el.dataset.quizHint = hint;
  return el;
}

describe("questionHint", () => {
  it("uses the slide's hint, then the deck's, for free text", () => {
    expect(questionHint(slide("One word"), "text", "Deck hint")).toBe("One word");
    expect(questionHint(slide(), "text", "Deck hint")).toBe("Deck hint");
  });

  it("uses the slide's hint or the default for multi-select, never the deck's", () => {
    expect(questionHint(slide("Pick any"), "multi", "Deck hint")).toBe("Pick any");
    expect(questionHint(slide(), "multi", "Deck hint")).toBe(MULTI_HINT);
  });

  it("shows no hint on single choice", () => {
    expect(questionHint(slide("ignored"), "choice", "Deck hint")).toBeUndefined();
  });
});

describe("displayUrl", () => {
  it("drops the protocol and query string", () => {
    expect(displayUrl("https://talk.example.com/quiz.html?accent=%23f00&wsUrl=x")).toBe("talk.example.com/quiz.html");
  });
});
