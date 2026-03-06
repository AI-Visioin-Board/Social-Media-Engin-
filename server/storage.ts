// Local filesystem storage — replaces Manus Forge S3 proxy
// Same function signatures so all 7+ consumer files need zero changes

import fs from "fs";
import path from "path";
import { ENV } from "./_core/env";

const getUploadsDir = () => {
  const dir = path.resolve(ENV.uploadsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const normalizeKey = (relKey: string) => relKey.replace(/^\/+/, "");

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const filePath = path.join(getUploadsDir(), key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const buffer = typeof data === "string" ? Buffer.from(data) : data;
  fs.writeFileSync(filePath, buffer);

  console.log(`[Storage] Saved ${key} (${buffer.length} bytes, ${contentType})`);
  const url = `/uploads/${key}`;
  return { key, url };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const filePath = path.join(getUploadsDir(), key);

  if (!fs.existsSync(filePath)) {
    console.warn(`[Storage] File not found: ${key}`);
  }

  return { key, url: `/uploads/${key}` };
}
