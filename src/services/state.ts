import fs from "node:fs";
import path from "node:path";
import { getConfig, type WeixinApiOptions } from "weixin/src/api/api.js";
import type { AppState, CLIState, TtsConfig } from "../types.js";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const STATE_FILE = path.join(import.meta.dir, "..", "..", ".wechat-cli-state.json");
export const MEDIA_DIR = path.join(import.meta.dir, "..", "..", ".media-downloads");
export const TTS_TEMP_DIR = path.join(import.meta.dir, "..", "..", ".tts-temp");

const DEFAULT_TTS_CONFIG: TtsConfig = {
  voice: "zh-CN-XiaoxiaoNeural",
  rate: "default",
  pitch: "default",
  volume: "default",
  proxy: "",
};

export function loadState(): CLIState {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch { /* ignore */ }
  return {};
}

export function saveState(state: CLIState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function getApiOpts(state: { token?: string | null; baseUrl?: string }): WeixinApiOptions {
  return { baseUrl: state.baseUrl || DEFAULT_BASE_URL, token: state.token ?? undefined };
}

export function buildInitialAppState(saved: CLIState): AppState {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const ttsConfig = { ...DEFAULT_TTS_CONFIG, ...saved.ttsConfig };
  if (!ttsConfig.proxy && envProxy) ttsConfig.proxy = envProxy;

  return {
    screen: saved.token ? "chat" : "login",
    token: saved.token ?? null,
    baseUrl: saved.baseUrl || DEFAULT_BASE_URL,
    accountId: saved.accountId ?? null,
    userId: saved.userId ?? null,
    targetUserId: saved.targetUserId ?? saved.userId ?? null,
    contextTokens: saved.contextTokens ?? {},
    messages: [],
    getUpdatesBuf: saved.getUpdatesBuf ?? "",
    showRawJson: false,
    connectionStatus: saved.token ? "polling" : "offline",
    ttsConfig,
  };
}

/**
 * Validate a saved token by making a lightweight getConfig probe.
 * Uses getConfig instead of getUpdates to avoid consuming messages
 * or competing with the poll loop.
 * Returns "valid" | "expired" | "error".
 */
export async function validateToken(token: string, baseUrl?: string): Promise<"valid" | "expired" | "error"> {
  try {
    const resp = await getConfig({
      baseUrl: baseUrl || DEFAULT_BASE_URL,
      token,
      ilinkUserId: "", // empty is fine for a probe
      timeoutMs: 10_000,
    });
    if (resp.ret === -14) return "expired";
    if (resp.ret === 0 || resp.ret === undefined) return "valid";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * Load state from primary file, with fallback to backup file.
 * If primary has no token but backup does, try the backup token.
 */
export const BACKUP_STATE_FILE = path.join(path.dirname(STATE_FILE), ".wechat-cli-state-bak.json");

export function loadStateWithFallback(): CLIState {
  const primary = loadState();
  if (primary.token) return primary;

  // Try backup
  try {
    if (fs.existsSync(BACKUP_STATE_FILE)) {
      const backup = JSON.parse(fs.readFileSync(BACKUP_STATE_FILE, "utf-8")) as CLIState;
      if (backup.token) return backup;
    }
  } catch { /* ignore */ }

  return primary;
}

/** Persist relevant AppState fields to disk. */
export function persistAppState(state: AppState) {
  const persisted: CLIState = {
    token: state.token ?? undefined,
    baseUrl: state.baseUrl !== DEFAULT_BASE_URL ? state.baseUrl : undefined,
    accountId: state.accountId ?? undefined,
    userId: state.userId ?? undefined,
    getUpdatesBuf: state.getUpdatesBuf || undefined,
    targetUserId: state.targetUserId ?? undefined,
    contextTokens: Object.keys(state.contextTokens).length > 0 ? state.contextTokens : undefined,
    ttsConfig: state.ttsConfig,
  };
  saveState(persisted);
}
