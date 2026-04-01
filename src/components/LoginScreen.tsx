import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { loginWithProgress, QR_TTL_MS, type LoginProgress } from "../services/login.js";
import type { AppAction } from "../types.js";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function LoginScreen({ dispatch }: { dispatch: React.Dispatch<AppAction> }) {
  const [progress, setProgress] = useState<LoginProgress>({ stage: "requesting" });
  const [remainingMs, setRemainingMs] = useState(QR_TTL_MS);

  // Login flow
  useEffect(() => {
    let cancelled = false;
    loginWithProgress((p) => {
      if (cancelled) return;
      setProgress(p);
      if (p.qrCreatedAt) {
        setRemainingMs(QR_TTL_MS - (Date.now() - p.qrCreatedAt));
      }
      if (p.stage === "confirmed" && p.result) {
        dispatch({
          type: "SET_TOKEN",
          token: p.result.token,
          baseUrl: p.result.baseUrl,
          accountId: p.result.accountId,
          userId: p.result.userId,
        });
        dispatch({ type: "SET_SCREEN", screen: "chat" });
      }
    }).catch((err) => {
      if (!cancelled) setProgress({ stage: "error", message: (err as Error).message });
    });
    return () => { cancelled = true; };
  }, []);

  // Countdown timer — update every second while QR is active
  useEffect(() => {
    if (progress.stage !== "qr_ready" || !progress.qrCreatedAt) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - progress.qrCreatedAt!;
      const remaining = QR_TTL_MS - elapsed;
      setRemainingMs(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [progress.stage, progress.qrCreatedAt]);

  const isExpiring = remainingMs > 0 && remainingMs < 60_000;
  const isExpired = remainingMs <= 0 && progress.stage === "qr_ready";

  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Text bold color="cyan">WeChat Bot Login</Text>
      <Text> </Text>

      {progress.stage === "requesting" && (
        <Text color="yellow">Requesting QR code...</Text>
      )}

      {progress.stage === "qr_ready" && !isExpired && progress.qrCode && (
        <>
          <Text>{progress.qrCode}</Text>
          <Box justifyContent="space-between" width={40}>
            <Text dimColor>{progress.qrUrl}</Text>
          </Box>
          <Text> </Text>
          <Box>
            <Text color="yellow">📱 Scan with WeChat </Text>
            <Text color={isExpiring ? "red" : "gray"}>
              ({formatCountdown(remainingMs)} remaining)
            </Text>
          </Box>
        </>
      )}

      {progress.stage === "qr_ready" && isExpired && (
        <>
          <Text color="red">⏰ QR code expired. Restart to get a new one.</Text>
          <Text dimColor>Run: bun start --login</Text>
        </>
      )}

      {progress.stage === "scanned" && (
        <Text color="green">👀 Scanned! Confirm on your phone...</Text>
      )}

      {progress.stage === "confirmed" && (
        <Text color="green">✅ Connected!</Text>
      )}

      {progress.stage === "expired" && (
        <>
          <Text color="red">⏰ QR code expired.</Text>
          <Text dimColor>Run: bun start --login</Text>
        </>
      )}

      {progress.stage === "error" && (
        <Text color="red">✗ {progress.message}</Text>
      )}
    </Box>
  );
}
