import multer from "multer";

export function sendUploadError(error, _req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Image must be 5 MB or smaller" });
    return res.status(400).json({ error: "Upload one image using the file field" });
  }
  if (error?.code === "INVALID_IMAGE_TYPE") return res.status(400).json({ error: error.message });
  next(error);
}
