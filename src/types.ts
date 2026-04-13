import type { MessageItem } from "weixin/src/api/types.js";

export type Message = {
  id: string;
  direction: "in" | "out" | "system";
  from?: string;
  text: string;
  time: string;
  filePath?: string;
  rawJson?: unknown;
  items?: MessageItem[];
};

export type ConnectionStatus = "connected" | "polling" | "expired" | "error" | "offline";

export type TtsConfig = {
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  proxy: string;
};

export type CLIState = {
  token?: string;
  baseUrl?: string;
  accountId?: string;
  userId?: string;
  getUpdatesBuf?: string;
  targetUserId?: string;
  contextTokens?: Record<string, string>;
  ttsConfig?: TtsConfig;
};

export type AppScreen = "login" | "chat";

export type AppState = {
  screen: AppScreen;
  // Connection
  token: string | null;
  baseUrl: string;
  accountId: string | null;
  userId: string | null;
  // Chat
  targetUserId: string | null;
  contextTokens: Record<string, string>;
  messages: Message[];
  // Sync
  getUpdatesBuf: string;
  // UI
  showRawJson: boolean;
  connectionStatus: ConnectionStatus;
  // TTS
  ttsConfig: TtsConfig;
};

export type AppAction =
  | { type: "SET_TOKEN"; token: string; baseUrl?: string; accountId?: string; userId?: string }
  | { type: "SET_TARGET"; userId: string }
  | { type: "SET_SCREEN"; screen: AppScreen }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "UPDATE_CONTEXT_TOKEN"; userId: string; token: string }
  | { type: "SET_UPDATES_BUF"; buf: string }
  | { type: "SET_CONNECTION_STATUS"; status: ConnectionStatus }
  | { type: "TOGGLE_RAW" }
  | { type: "SET_TTS_CONFIG"; config: Partial<TtsConfig> }
  | { type: "CLEAR_SESSION" };

// --- Send log types ---

export type SendStatus = "pending" | "sent" | "failed" | "retrying";

export interface SendLogEntry {
  /** Unique send attempt ID */
  id: string;
  /** ISO timestamp */
  ts: string;
  /** Target WeChat userId */
  toUserId: string;
  /** context_token used */
  contextToken: string;
  /** Message content type */
  contentType: "text" | "image" | "video" | "file" | "voice" | "tts";
  /** Text content or file path */
  payload: string;
  status: SendStatus;
  /** Attempt count (starts at 1) */
  attempts: number;
  /** HTTP status code from last attempt */
  httpStatus?: number;
  /** Business ret code from response body */
  retCode?: number;
  /** Error message from last attempt */
  error?: string;
  /** ISO timestamp of last attempt */
  lastAttemptTs?: string;
}
