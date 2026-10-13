import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

/** Local-disk attachment store behind a tiny interface — swap `save/open/remove` for S3/GCS/Azure Blob in production. */
const root = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(root, { recursive: true });

export const storage = {
  async save(buf: Buffer): Promise<string> {
    const key = crypto.randomBytes(24).toString("hex");
    await fs.promises.writeFile(path.join(root, key), buf, { mode: 0o640 });
    return key;
  },
  open: (key: string) => fs.createReadStream(path.join(root, path.basename(key))),
  remove: (key: string) => fs.promises.rm(path.join(root, path.basename(key)), { force: true }),
};

// -------- upload validation: extension allow-list + magic-number sniffing (never trust client MIME) --------
const ALLOWED: Record<string, { mime: string; magic?: number[] }> = {
  png: { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  gif: { mime: "image/gif", magic: [0x47, 0x49, 0x46] },
  webp: { mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] },
  pdf: { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [0x50, 0x4b] },
  txt: { mime: "text/plain" },
  log: { mime: "text/plain" },
  csv: { mime: "text/csv" },
};

export function validateUpload(name: string, buf: Buffer): { mime: string; safeName: string } | string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const rule = ALLOWED[ext];
  if (!rule) return `File type .${ext || "?"} is not allowed`;
  if (rule.magic && !rule.magic.every((b, i) => buf[i] === b)) return `File content does not match its .${ext} extension`;
  if (!rule.magic && buf.includes(0)) return "Text files must not contain binary data";
  const safeName = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
  return { mime: rule.mime, safeName };
}
