import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import {
  sendMessage as sendMessageApi,
  getUploadUrl,
  type WeixinApiOptions,
  type SendMessageResult,
} from "weixin/src/api/api.js";
import { MessageItemType, MessageType, MessageState, UploadMediaType, type MessageItem, type SendMessageReq } from "weixin/src/api/types.js";
import { aesEcbPaddedSize } from "weixin/src/cdn/aes-ecb.js";
import { uploadBufferToCdn } from "weixin/src/cdn/cdn-upload.js";
import { generateId } from "weixin/src/util/random.js";
import { CDN_BASE_URL } from "./state.js";
import { sendWithRetry, type SendAttemptResult } from "./send-queue.js";
import type { SendLogEntry } from "../types.js";

export type SendResult =
  | { ok: true; detail: string; logEntry?: SendLogEntry }
  | { ok: false; error: string; logEntry?: SendLogEntry };

/**
 * Convert patched SDK SendMessageResult into our retry-compatible SendAttemptResult.
 * Checks both HTTP status and business-level ret/errcode.
 */
function toAttemptResult(r: SendMessageResult): SendAttemptResult {
  const bizErr = (r.ret !== undefined && r.ret !== 0) || (r.errcode !== undefined && r.errcode !== 0);
  if (bizErr) {
    return {
      ok: false,
      httpStatus: r.httpStatus,
      retCode: r.ret ?? r.errcode,
      error: `Business error ret=${r.ret ?? r.errcode}: ${r.errmsg || "unknown"}`,
      rawBody: r.rawBody,
    };
  }
  return { ok: true, httpStatus: r.httpStatus, retCode: 0, rawBody: r.rawBody };
}

function buildMsg(to: string, contextToken: string, items: MessageItem[]): SendMessageReq {
  return {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: generateId("wechat-cli"),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: items,
    },
  };
}

/** Send the message body via the patched SDK and convert to SendAttemptResult. */
export function makeSendFn(opts: WeixinApiOptions, body: SendMessageReq): () => Promise<SendAttemptResult> {
  return async () => {
    const result = await sendMessageApi({ ...opts, body });
    return toAttemptResult(result);
  };
}

export async function sendText(opts: WeixinApiOptions, to: string, contextToken: string, text: string): Promise<SendResult> {
  try {
    const body = buildMsg(to, contextToken, [{ type: MessageItemType.TEXT, text_item: { text } }]);
    const entry = await sendWithRetry(
      { toUserId: to, contextToken, contentType: "text", payload: text },
      makeSendFn(opts, body),
    );
    if (entry.status === "sent") return { ok: true, detail: "Text sent", logEntry: entry };
    return { ok: false, error: entry.error || "Send failed after retries", logEntry: entry };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function uploadMedia(opts: WeixinApiOptions, filePath: string, toUserId: string, mediaType: number) {
  const plaintext = await fs.promises.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  const uploadResp = await getUploadUrl({
    ...opts, filekey, media_type: mediaType, to_user_id: toUserId,
    rawsize, rawfilemd5, filesize, no_need_thumb: true, aeskey: aeskey.toString("hex"),
  });
  if (!uploadResp.upload_param) throw new Error("getUploadUrl: no upload_param");

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext, uploadParam: uploadResp.upload_param, filekey,
    cdnBaseUrl: CDN_BASE_URL, aeskey, label: "cli-upload",
  });

  return {
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

export async function sendImage(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  try {
    const u = await uploadMedia(opts, filePath, to, UploadMediaType.IMAGE);
    const body = buildMsg(to, contextToken, [{
      type: MessageItemType.IMAGE,
      image_item: {
        media: { encrypt_query_param: u.downloadEncryptedQueryParam, aes_key: Buffer.from(u.aeskey, "hex").toString("base64"), encrypt_type: 1 },
        mid_size: u.fileSizeCiphertext,
      },
    }]);
    const entry = await sendWithRetry(
      { toUserId: to, contextToken, contentType: "image", payload: filePath },
      makeSendFn(opts, body),
    );
    if (entry.status === "sent") return { ok: true, detail: "Image sent", logEntry: entry };
    return { ok: false, error: entry.error || "Send failed", logEntry: entry };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendVideo(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  try {
    const u = await uploadMedia(opts, filePath, to, UploadMediaType.VIDEO);
    const body = buildMsg(to, contextToken, [{
      type: MessageItemType.VIDEO,
      video_item: {
        media: { encrypt_query_param: u.downloadEncryptedQueryParam, aes_key: Buffer.from(u.aeskey, "hex").toString("base64"), encrypt_type: 1 },
        video_size: u.fileSizeCiphertext,
      },
    }]);
    const entry = await sendWithRetry(
      { toUserId: to, contextToken, contentType: "video", payload: filePath },
      makeSendFn(opts, body),
    );
    if (entry.status === "sent") return { ok: true, detail: "Video sent", logEntry: entry };
    return { ok: false, error: entry.error || "Send failed", logEntry: entry };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendFile(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  try {
    const fileName = path.basename(filePath);
    const u = await uploadMedia(opts, filePath, to, UploadMediaType.FILE);
    const body = buildMsg(to, contextToken, [{
      type: MessageItemType.FILE,
      file_item: {
        media: { encrypt_query_param: u.downloadEncryptedQueryParam, aes_key: Buffer.from(u.aeskey, "hex").toString("base64"), encrypt_type: 1 },
        file_name: fileName, len: String(u.fileSize),
      },
    }]);
    const entry = await sendWithRetry(
      { toUserId: to, contextToken, contentType: "file", payload: filePath },
      makeSendFn(opts, body),
    );
    if (entry.status === "sent") return { ok: true, detail: `File "${fileName}" sent`, logEntry: entry };
    return { ok: false, error: entry.error || "Send failed", logEntry: entry };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendVoice(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  return sendFile(opts, to, contextToken, filePath);
}

export async function resendText(opts: WeixinApiOptions, to: string, contextToken: string, text: string): Promise<SendResult> {
  return sendText(opts, to, contextToken, text);
}
