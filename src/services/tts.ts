import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sendMessage as sendMessageApi, getUploadUrl, type WeixinApiOptions } from "weixin/src/api/api.js";
import { MessageItemType, MessageType, MessageState, UploadMediaType } from "weixin/src/api/types.js";
import { aesEcbPaddedSize } from "weixin/src/cdn/aes-ecb.js";
import { uploadBufferToCdn } from "weixin/src/cdn/cdn-upload.js";
import { generateId } from "weixin/src/util/random.js";
import type { TtsConfig } from "../types.js";
import { CDN_BASE_URL, TTS_TEMP_DIR } from "./state.js";
import type { SendResult } from "./api.js";

export const TTS_VOICE_CATALOG: { name: string; id: string; gender: string; style: string }[] = [
  // Female
  { name: "xiaoxiao",   id: "zh-CN-XiaoxiaoNeural",              gender: "F", style: "通用女声 (默认)" },
  { name: "xiaoyi",     id: "zh-CN-XiaoyiNeural",                gender: "F", style: "温柔女声" },
  { name: "xiaohan",    id: "zh-CN-XiaohanNeural",               gender: "F", style: "温暖女声" },
  { name: "xiaomeng",   id: "zh-CN-XiaomengNeural",              gender: "F", style: "可爱少女" },
  { name: "xiaomo",     id: "zh-CN-XiaomoNeural",                gender: "F", style: "活泼女声" },
  { name: "xiaoqiu",    id: "zh-CN-XiaoqiuNeural",               gender: "F", style: "知性女声" },
  { name: "xiaorou",    id: "zh-CN-XiaorouNeural",               gender: "F", style: "柔美女声" },
  { name: "xiaorui",    id: "zh-CN-XiaoruiNeural",               gender: "F", style: "成熟女声" },
  { name: "xiaoshuang", id: "zh-CN-XiaoshuangNeural",            gender: "F", style: "儿童女声" },
  { name: "xiaoyan",    id: "zh-CN-XiaoyanNeural",               gender: "F", style: "沉稳女声" },
  { name: "xiaoyou",    id: "zh-CN-XiaoyouNeural",               gender: "F", style: "儿童女声" },
  { name: "xiaozhen",   id: "zh-CN-XiaozhenNeural",              gender: "F", style: "率真女声" },
  { name: "xiaochen",   id: "zh-CN-XiaochenNeural",              gender: "F", style: "轻松女声" },
  // Male
  { name: "yunxi",      id: "zh-CN-YunxiNeural",                 gender: "M", style: "阳光男声" },
  { name: "yunjian",    id: "zh-CN-YunjianNeural",               gender: "M", style: "体育解说" },
  { name: "yunyang",    id: "zh-CN-YunyangNeural",               gender: "M", style: "新闻播音" },
  { name: "yunhao",     id: "zh-CN-YunhaoNeural",                gender: "M", style: "广告男声" },
  { name: "yunfeng",    id: "zh-CN-YunfengNeural",               gender: "M", style: "沉稳男声" },
  { name: "yunze",      id: "zh-CN-YunzeNeural",                 gender: "M", style: "讲故事" },
  // Multilingual
  { name: "xiaoxiao-ml",id: "zh-CN-XiaoxiaoMultilingualNeural",  gender: "F", style: "多语言女声" },
  { name: "xiaochen-ml",id: "zh-CN-XiaochenMultilingualNeural",  gender: "F", style: "多语言女声" },
  { name: "xiaoyu-ml",  id: "zh-CN-XiaoyuMultilingualNeural",    gender: "F", style: "多语言女声" },
  // Dialects
  { name: "xiaobei",    id: "zh-CN-liaoning-XiaobeiNeural",      gender: "F", style: "东北方言" },
  { name: "xiaoni",     id: "zh-CN-shaanxi-XiaoniNeural",        gender: "F", style: "陕西方言" },
  { name: "dialects",   id: "zh-CN-XiaoxiaoDialectsNeural",      gender: "F", style: "方言合集" },
];

export function findVoice(nameOrId: string): typeof TTS_VOICE_CATALOG[0] | undefined {
  const key = nameOrId.toLowerCase();
  return TTS_VOICE_CATALOG.find((v) => v.name === key || v.id.toLowerCase() === key);
}

export async function ttsAndSendFile(
  opts: WeixinApiOptions,
  to: string,
  contextToken: string,
  text: string,
  config: TtsConfig,
  onStatus?: (msg: string) => void,
): Promise<SendResult> {
  try {
    fs.mkdirSync(TTS_TEMP_DIR, { recursive: true });
    const entry = TTS_VOICE_CATALOG.find((v) => v.id === config.voice);
    const voiceLabel = entry ? `${entry.name}` : config.voice;
    onStatus?.(`TTS: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}" (${voiceLabel})`);

    // Edge TTS → MP3
    const { EdgeTTS } = await import("node-edge-tts");
    const tts = new EdgeTTS({
      voice: config.voice,
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      rate: config.rate,
      pitch: config.pitch,
      volume: config.volume,
      timeout: 30000,
      ...(config.proxy ? { proxy: config.proxy } : {}),
    });
    const mp3Path = path.join(TTS_TEMP_DIR, `tts-${Date.now()}.mp3`);
    try {
      await tts.ttsPromise(text, mp3Path);
    } catch (ttsErr) {
      const msg = ttsErr instanceof Error ? ttsErr.message : String(ttsErr ?? "unknown");
      throw new Error(`Edge TTS failed: ${msg}`);
    }
    if (!fs.existsSync(mp3Path)) throw new Error("Edge TTS produced no output");
    const mp3Size = fs.statSync(mp3Path).size;
    if (mp3Size < 100) { fs.unlinkSync(mp3Path); throw new Error("TTS output too small"); }

    // Upload + send as file
    const fileName = `tts-${voiceLabel}.mp3`;
    onStatus?.(`Uploading ${fileName} (${mp3Size} bytes)...`);

    const plaintext = fs.readFileSync(mp3Path);
    const rawsize = plaintext.length;
    const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
    const filesize = aesEcbPaddedSize(rawsize);
    const filekey = crypto.randomBytes(16).toString("hex");
    const aeskey = crypto.randomBytes(16);

    const uploadResp = await getUploadUrl({
      ...opts, filekey, media_type: UploadMediaType.FILE, to_user_id: to,
      rawsize, rawfilemd5, filesize, no_need_thumb: true, aeskey: aeskey.toString("hex"),
    });
    if (!uploadResp.upload_param) throw new Error("getUploadUrl: no upload_param");

    const { downloadParam } = await uploadBufferToCdn({
      buf: plaintext, uploadParam: uploadResp.upload_param, filekey,
      cdnBaseUrl: CDN_BASE_URL, aeskey, label: "cli-tts",
    });

    await sendMessageApi({
      ...opts,
      body: {
        msg: {
          from_user_id: "", to_user_id: to, client_id: generateId("wechat-cli"),
          message_type: MessageType.BOT, message_state: MessageState.FINISH, context_token: contextToken,
          item_list: [{
            type: MessageItemType.FILE,
            file_item: {
              media: { encrypt_query_param: downloadParam, aes_key: Buffer.from(aeskey.toString("hex")).toString("base64"), encrypt_type: 1 },
              file_name: fileName, len: String(rawsize),
            },
          }],
        },
      },
    });

    fs.unlinkSync(mp3Path);
    return { ok: true, detail: `TTS "${fileName}" sent` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
