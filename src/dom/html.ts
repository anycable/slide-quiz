/**
 * Lightweight tagged-template helper for declarative DOM creation.
 *
 * Returns a DocumentFragment — append it directly to any parent element.
 * Interpolated values are HTML-escaped by default. Nodes (including other
 * fragments) are serialized into markup so they compose naturally.
 */

export type Child =
  | string
  | number
  | Node
  | Child[]
  | null
  | undefined
  | false;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveValue(value: Child): string {
  if (value == null || value === false) return "";

  if (Array.isArray(value)) {
    return value.map(resolveValue).join("");
  }

  if (value instanceof Node) {
    const container = document.createElement("div");
    container.appendChild(value);
    return container.innerHTML;
  }

  return escapeHtml(String(value));
}

export function html(
  strings: TemplateStringsArray,
  ...values: Child[]
): DocumentFragment {
  const template = document.createElement("template");

  let result = "";
  strings.forEach((str, i) => {
    result += str;
    if (i < values.length) {
      result += resolveValue(values[i]);
    }
  });

  template.innerHTML = result;
  return template.content;
}
