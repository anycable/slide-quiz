import { describe, it, expect } from "vitest";
import { audienceText } from "../src/quiz-types";
import { audienceLine, updateTotal } from "../src/dom/render-results";
import { CLS } from "../src/dom/selectors";

describe("audienceText", () => {
  it("names who is connected and who responded", () => {
    expect(audienceText(12, 9)).toBe("12 connected · 9 responded");
    expect(audienceText(1, 1)).toBe("1 connected · 1 responded");
    expect(audienceText(0, 0)).toBe("0 connected · 0 responded");
  });
});

describe("audienceLine", () => {
  function line(): HTMLElement {
    const p = document.createElement("p");
    p.className = CLS.resultsTotal;
    p.appendChild(audienceLine());
    return p;
  }

  it("reads like audienceText", () => {
    expect(line().textContent).toBe(audienceText(0, 0));
  });

  it("keeps the connected count in an online span, which the plugin updates", () => {
    const p = line();
    const online = p.querySelector<HTMLElement>(`.${CLS.online}`)!;
    online.textContent = "12";
    updateTotal(p, { votes: {}, total: 9 });
    expect(p.textContent).toBe(audienceText(12, 9));
  });
});
