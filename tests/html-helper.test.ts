import { describe, it, expect } from "vitest";
import { html } from "../src/dom/html";

describe("html tagged template", () => {
  it("creates a DocumentFragment from markup", () => {
    const frag = html`<div class="test">hello</div>`;
    expect(frag).toBeInstanceOf(DocumentFragment);
    const div = frag.querySelector("div");
    expect(div?.className).toBe("test");
    expect(div?.textContent).toBe("hello");
  });

  it("escapes interpolated strings (prevents XSS)", () => {
    const userInput = '<script>alert("xss")</script>';
    const frag = html`<p>${userInput}</p>`;
    const p = frag.querySelector("p")!;
    expect(p.textContent).toBe(userInput);
    expect(p.innerHTML).not.toContain("<script>");
  });

  it("suppresses null, undefined, and false", () => {
    const frag = html`<div>${null}${undefined}${false}</div>`;
    const div = frag.querySelector("div")!;
    expect(div.innerHTML).toBe("");
  });

  it("renders numbers as text", () => {
    const frag = html`<span>${42}</span>`;
    expect(frag.querySelector("span")?.textContent).toBe("42");
  });

  it("composes nested fragments", () => {
    const inner = html`<span>inner</span>`;
    const outer = html`<div>${inner}</div>`;
    const div = outer.querySelector("div")!;
    expect(div.querySelector("span")?.textContent).toBe("inner");
  });

  it("flattens arrays", () => {
    const items = ["a", "b", "c"];
    const frag = html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`;
    const lis = frag.querySelectorAll("li");
    expect(lis).toHaveLength(3);
    expect(lis[0].textContent).toBe("a");
    expect(lis[2].textContent).toBe("c");
  });

  it("handles conditional rendering with ternary", () => {
    const show = false;
    const frag = html`<div>${show ? html`<span>yes</span>` : null}</div>`;
    expect(frag.querySelector("span")).toBeNull();
  });
});
