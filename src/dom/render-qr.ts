import QRCode from "qrcode";

/**
 * Detect whether the presentation background is light or dark
 * by reading the Reveal.js --r-background-color CSS variable.
 */
function isLightBackground(): boolean {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--r-background-color")
    .trim();
  if (!bg) return false;

  // Parse hex color to determine luminance
  const hex = bg.replace("#", "");
  if (!/^[0-9a-fA-F]{3,8}$/.test(hex)) return false;
  const full = hex.length <= 4
    ? hex.split("").map((c) => c + c).join("")
    : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Perceived luminance
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

/**
 * Generate a QR code image element at runtime.
 * Returns an <img> with the QR as a data URL.
 */
export async function renderQR(
  url: string,
  size = 240,
): Promise<HTMLImageElement> {
  const light = isLightBackground();
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
  img.className = "lq-qr";
  img.width = size;
  img.height = size;
  return img;
}
