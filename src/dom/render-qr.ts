import QRCode from "qrcode";

/**
 * Generate a QR code image element at runtime.
 * Returns an <img> with the QR as a data URL.
 */
export async function renderQR(
  url: string,
  size = 240,
): Promise<HTMLImageElement> {
  const dataUrl = await QRCode.toDataURL(url, {
    width: size,
    margin: 1,
    color: { dark: "#ffffff", light: "#00000000" },
  });

  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = `Scan to join: ${url}`;
  img.className = "lq-qr";
  img.width = size;
  img.height = size;
  return img;
}
