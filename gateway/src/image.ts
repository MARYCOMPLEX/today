import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { getImageUploadUrl } from "./ilink";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_REQUEST_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const CDN_UPLOAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";
export interface ImageType { mime: SupportedImageMime; extension: "jpg" | "png" | "webp" }

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mime: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }
  return null;
}

export function validateImage(bytes: Uint8Array): ImageType {
  if (bytes.length === 0) throw new Error("image_empty");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("image_max_20_mib");
  const type = detectImageType(bytes);
  if (!type) throw new Error("unsupported_image_type");
  return type;
}

export interface UploadedImage {
  downloadParam: string;
  aesKeyBase64: string;
  encryptedSize: number;
}

export async function uploadImage(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  bytes: Uint8Array;
}): Promise<UploadedImage> {
  const plaintext = Buffer.from(params.bytes);
  const fileKey = randomBytes(16).toString("hex");
  const aesKey = randomBytes(16);
  const cipher = createCipheriv("aes-128-ecb", aesKey, Buffer.alloc(0));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const upload = await getImageUploadUrl({
    baseUrl: params.baseUrl,
    token: params.token,
    toUserId: params.toUserId,
    fileKey,
    rawSize: plaintext.length,
    rawMd5: createHash("md5").update(plaintext).digest("hex"),
    encryptedSize: encrypted.length,
    aesKeyHex: aesKey.toString("hex"),
  });
  const code = upload.errcode ?? upload.ret ?? 0;
  if (code !== 0 || (!upload.upload_full_url && !upload.upload_param)) {
    throw new Error(`iLink getuploadurl ret=${code}`);
  }
  const url = upload.upload_full_url?.trim() || `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param!)}&filekey=${encodeURIComponent(fileKey)}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= CDN_UPLOAD_ATTEMPTS; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: encrypted,
      });
    } catch (error) {
      lastError = error;
    }
    if (response) {
      const downloadParam = response.headers.get("x-encrypted-param");
      if (response.status === 200 && downloadParam) {
        return {
          downloadParam,
          aesKeyBase64: Buffer.from(aesKey.toString("hex")).toString("base64"),
          encryptedSize: encrypted.length,
        };
      }
      const error = new Error(`iLink CDN upload status=${response.status}`);
      if (response.status !== 429 && response.status >= 400 && response.status < 500) throw error;
      lastError = error;
    }
    if (attempt < CDN_UPLOAD_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`iLink CDN upload failed after ${CDN_UPLOAD_ATTEMPTS} attempts`, { cause: lastError });
}
