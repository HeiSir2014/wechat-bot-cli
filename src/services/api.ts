import crypto from "node:crypto";
import path from "node:path";
import {
  sendMessage as sendMessageApi,
  getUploadUrl,
  type WeixinApiOptions,
} from "weixin/src/api/api.js";
import { MessageItemType, MessageType, MessageState, UploadMediaType, type MessageItem } from "weixin/src/api/types.js";
import { aesEcbPaddedSize } from "weixin/src/cdn/aes-ecb.js";
import { uploadBufferToCdn } from "weixin/src/cdn/cdn-upload.js";
import { generateId } from "weixin/src/util/random.js";
import { CDN_BASE_URL } from "./state.js";
import fs from "node:fs";

export type SendResult = { ok: true; detail: string } | { ok: false; error: string };

function buildMediaMsg(
  opts: WeixinApiOptions,
  to: string,
  contextToken: string,
  item: MessageItem,
) {
  return {
    ...opts,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: generateId("wechat-cli"),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: contextToken,
        item_list: [item],
      },
    },
  };
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

export async function sendText(opts: WeixinApiOptions, to: string, contextToken: string, text: string): Promise<SendResult> {
  try {
    await sendMessageApi({
      ...opts,
      body: {
        msg: {
          from_user_id: "", to_user_id: to, client_id: generateId("wechat-cli"),
          message_type: MessageType.BOT, message_state: MessageState.FINISH, context_token: contextToken,
          item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
        },
      },
    });
    return { ok: true, detail: "Text sent" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendImage(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  try {
    const u = await uploadMedia(opts, filePath, to, UploadMediaType.IMAGE);
    await sendMessageApi(buildMediaMsg(opts, to, contextToken, { type: MessageItemType.IMAGE, image_item: {
      media: { encrypt_query_param: u.downloadEncryptedQueryParam, aes_key: Buffer.from(u.aeskey, "hex").toString("base64"), encrypt_type: 1 },
      mid_size: u.fileSizeCiphertext,
    }}));
    return { ok: true, detail: "Image sent" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendVideo(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  try {
    const u = await uploadMedia(opts, filePath, to, UploadMediaType.VIDEO);
    await sendMessageApi(buildMediaMsg(opts, to, contextToken, { type: MessageItemType.VIDEO, video_item: {
      media: { encrypt_query_param: u.downloadEncryptedQueryParam, aes_key: Buffer.from(u.aeskey, "hex").toString("base64"), encrypt_type: 1 },
      video_size: u.fileSizeCiphertext,
    }}));
    return { ok: true, detail: "Video sent" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendFile(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  try {
    const fileName = path.basename(filePath);
    const u = await uploadMedia(opts, filePath, to, UploadMediaType.FILE);
    await sendMessageApi(buildMediaMsg(opts, to, contextToken, { type: MessageItemType.FILE, file_item: {
      media: { encrypt_query_param: u.downloadEncryptedQueryParam, aes_key: Buffer.from(u.aeskey, "hex").toString("base64"), encrypt_type: 1 },
      file_name: fileName, len: String(u.fileSize),
    }}));
    return { ok: true, detail: `File "${fileName}" sent` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendVoice(opts: WeixinApiOptions, to: string, contextToken: string, filePath: string): Promise<SendResult> {
  // Bot API does not support VOICE type — send as file
  return sendFile(opts, to, contextToken, filePath);
}
