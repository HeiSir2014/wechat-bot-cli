import { startWeixinLoginWithQr, waitForWeixinLogin } from "weixin/src/auth/login-qr.js";
import { DEFAULT_BASE_URL } from "./state.js";

export type LoginResult = {
  token: string;
  baseUrl?: string;
  accountId?: string;
  userId?: string;
};

export async function showQrInTerminal(text: string): Promise<string> {
  try {
    const qrcode = await import("qrcode-terminal");
    const mod = qrcode.default ?? qrcode;
    return new Promise<string>((resolve) => {
      mod.generate(text, { small: true }, (code: string) => {
        resolve(code);
      });
    });
  } catch {
    return `QR URL: ${text}`;
  }
}

export const QR_TTL_MS = 5 * 60_000; // 5 minutes

export type LoginProgress = {
  stage: "requesting" | "qr_ready" | "scanned" | "confirmed" | "error" | "expired";
  qrCode?: string;
  qrUrl?: string;
  qrCreatedAt?: number; // Date.now() when QR was generated
  message?: string;
  result?: LoginResult;
};

/**
 * Login with QR scan. Calls onProgress at each stage.
 */
export async function loginWithProgress(
  onProgress: (p: LoginProgress) => void,
): Promise<LoginResult> {
  onProgress({ stage: "requesting" });

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl: DEFAULT_BASE_URL,
    verbose: false,
    force: true,
  });

  if (!startResult.qrcodeUrl) {
    onProgress({ stage: "error", message: startResult.message });
    throw new Error(startResult.message);
  }

  const qrCode = await showQrInTerminal(startResult.qrcodeUrl);
  onProgress({ stage: "qr_ready", qrCode, qrUrl: startResult.qrcodeUrl, qrCreatedAt: Date.now() });

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
    verbose: false,
    timeoutMs: 5 * 60_000,
  });

  if (!waitResult.connected || !waitResult.botToken) {
    onProgress({ stage: "error", message: waitResult.message });
    throw new Error(waitResult.message);
  }

  const result: LoginResult = {
    token: waitResult.botToken,
    baseUrl: waitResult.baseUrl,
    accountId: waitResult.accountId,
    userId: waitResult.userId,
  };

  onProgress({ stage: "confirmed", result, message: waitResult.message });
  return result;
}
