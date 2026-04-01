import fs from "node:fs";
import path from "node:path";
import { MessageItemType, type MessageItem } from "weixin/src/api/types.js";
import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from "weixin/src/cdn/pic-decrypt.js";
import { CDN_BASE_URL, MEDIA_DIR } from "./state.js";

export function resolveFilePath(input: string): string {
  let p = input.trim();
  if (p.startsWith("file://")) p = p.slice(7);
  if (p.startsWith("~")) p = path.join(process.env.HOME ?? "/root", p.slice(1));
  return path.resolve(p);
}

export function formatItem(item: MessageItem): string {
  switch (item.type) {
    case MessageItemType.TEXT: return item.text_item?.text ?? "";
    case MessageItemType.IMAGE: return "📷 [image]";
    case MessageItemType.VOICE: return `🎤 [voice ${item.voice_item?.playtime ?? "?"}ms]`;
    case MessageItemType.FILE: return `📎 ${item.file_item?.file_name ?? "unnamed"} (${item.file_item?.len ?? "?"} bytes)`;
    case MessageItemType.VIDEO: return "🎬 [video]";
    default: return `[type=${item.type}]`;
  }
}

export async function downloadInboundMedia(item: MessageItem): Promise<string | undefined> {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  try {
    if (item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param) {
      const img = item.image_item;
      const aesKeyBase64 = img.aeskey ? Buffer.from(img.aeskey, "hex").toString("base64") : img.media!.aes_key;
      const buf = aesKeyBase64
        ? await downloadAndDecryptBuffer(img.media!.encrypt_query_param!, aesKeyBase64, CDN_BASE_URL, "cli")
        : await downloadPlainCdnBuffer(img.media!.encrypt_query_param!, CDN_BASE_URL, "cli");
      const dest = path.join(MEDIA_DIR, `image-${Date.now()}.jpg`);
      fs.writeFileSync(dest, buf);
      return dest;
    }
    if (item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param && item.file_item.media.aes_key) {
      const fi = item.file_item;
      const buf = await downloadAndDecryptBuffer(fi.media!.encrypt_query_param!, fi.media!.aes_key!, CDN_BASE_URL, "cli");
      const dest = path.join(MEDIA_DIR, fi.file_name ?? `file-${Date.now()}`);
      fs.writeFileSync(dest, buf);
      return dest;
    }
    if (item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param && item.video_item.media.aes_key) {
      const vi = item.video_item;
      const buf = await downloadAndDecryptBuffer(vi.media!.encrypt_query_param!, vi.media!.aes_key!, CDN_BASE_URL, "cli");
      const dest = path.join(MEDIA_DIR, `video-${Date.now()}.mp4`);
      fs.writeFileSync(dest, buf);
      return dest;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
