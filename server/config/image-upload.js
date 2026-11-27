const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

function isSupportedImage(buffer, mimeType) {
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export function parseImageDataUri(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ""));
  if (!match || match[2].length % 4 !== 0 || !base64Pattern.test(match[2])) {
    const error = new Error("Upload a valid JPG, PNG, or WebP image"); error.status = 400; throw error;
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) { const error = new Error("The uploaded image is empty"); error.status = 400; throw error; }
  if (buffer.length > MAX_IMAGE_BYTES) { const error = new Error("Image must be 5 MB or smaller"); error.status = 413; throw error; }
  if (!isSupportedImage(buffer, match[1])) { const error = new Error("Image contents do not match the selected JPG, PNG, or WebP file type"); error.status = 400; throw error; }
  return { buffer, mimeType: match[1] };
}

export { MAX_IMAGE_BYTES };
