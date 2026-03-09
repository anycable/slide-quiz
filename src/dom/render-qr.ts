import QRCode from "qrcode";

/**
 * Detect whether the given element (or page) has a light background
 * by reading getComputedStyle().backgroundColor.
 * Falls back to the Reveal.js --r-background-color CSS variable.
 */
/** @internal — exported for testing */
export function isLightBackground(element?: HTMLElement): boolean {
  // Try computed background color on the element itself
  if (element) {
    const bg = getComputedStyle(element).backgroundColor;
    const rgb = parseRgb(bg);
    if (rgb) return luminance(rgb) > 128;
  }

  // Fallback: Reveal.js CSS variable on :root
  const cssVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--r-background-color")
    .trim();
  if (cssVar) {
    const rgb = parseRgb(cssVar) ?? parseHex(cssVar);
    if (rgb) return luminance(rgb) > 128;
  }

  return false;
}

type RGB = [number, number, number];

function parseRgb(value: string): RGB | null {
  const m = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return null;
  // Skip fully transparent backgrounds — they carry no useful color info
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseHex(value: string): RGB | null {
  const hex = value.replace("#", "");
  if (!/^[0-9a-fA-F]{3,8}$/.test(hex)) return null;
  const full =
    hex.length <= 4
      ? hex.split("").map((c) => c + c).join("")
      : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: RGB): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Generate a QR code image element at runtime.
 * Returns an <img> with the QR as a data URL.
 */
export async function renderQR(
  url: string,
  size = 240,
  slideElement?: HTMLElement,
): Promise<HTMLImageElement> {
  const light = isLightBackground(slideElement);
  const dataUrl = await QRCode.toDataURL(url, {
    width: size,
    margin: 1,
    color: {
      dark: light ? "#000000" : "#ffffff",
      light: "#00000000",
    },
  });

  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = `Scan to join: ${url}`;
  img.className = "sq-qr";
  img.width = size;
  img.height = size;
  return img;
}
