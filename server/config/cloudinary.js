import { v2 as cloudinary } from "cloudinary";
import { Readable } from "node:stream";

export function hasCloudinaryConfig() {
  return [process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET].every((value) => Boolean(value?.trim()));
}

export function uploadImageBuffer(buffer, folder) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder,
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      use_filename: false,
      unique_filename: true,
      overwrite: false,
    }, (error, result) => error ? reject(error) : resolve(result));
    Readable.from(buffer).pipe(stream);
  });
}
