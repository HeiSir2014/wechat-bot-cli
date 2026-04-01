/**
 * Shim for openclaw/plugin-sdk.
 * Implements the runtime functions used by @tencent-weixin/openclaw-weixin.
 * Logs are written to ./logs/ by the weixin logger (JSONL format).
 * Use `bun run logs.ts` to view logs in readable format.
 */

import fs from "node:fs";
import path from "node:path";

// ── resolvePreferredOpenClawTmpDir ──────────────────────────────────────

const LOG_DIR = path.join(import.meta.dir, "..", "logs");

export function resolvePreferredOpenClawTmpDir(): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  return LOG_DIR;
}

// ── normalizeAccountId ──────────────────────────────────────────────────

const DEFAULT_ACCOUNT_ID = "default";
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

export function normalizeAccountId(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return DEFAULT_ACCOUNT_ID;
  if (VALID_ID_RE.test(trimmed)) return trimmed.toLowerCase();
  return (
    trimmed
      .toLowerCase()
      .replace(INVALID_CHARS_RE, "-")
      .replace(LEADING_DASH_RE, "")
      .replace(TRAILING_DASH_RE, "")
      .slice(0, 64) || DEFAULT_ACCOUNT_ID
  );
}

// ── stripMarkdown ───────────────────────────────────────────────────────

export function stripMarkdown(text: string): string {
  let result = text;
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/__(.+?)__/g, "$1");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");
  result = result.replace(/~~(.+?)~~/g, "$1");
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  result = result.replace(/^>\s?(.*)$/gm, "$1");
  result = result.replace(/^[-*_]{3,}$/gm, "");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

// ── withFileLock ────────────────────────────────────────────────────────

export async function withFileLock<T>(
  _filePath: string,
  _opts: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}

// ── buildChannelConfigSchema ────────────────────────────────────────────

export function buildChannelConfigSchema(schema: unknown): unknown {
  return schema;
}

// ── Stub types ──────────────────────────────────────────────────────────

export type OpenClawConfig = Record<string, unknown>;
export type PluginRuntime = Record<string, unknown>;
export type ChannelPlugin<T = unknown> = Record<string, unknown> & { __t?: T };
export type ChannelAccountSnapshot = Record<string, unknown>;
export type ReplyPayload = { text?: string; mediaUrl?: string; mediaUrls?: string[] };
export type { OpenClawConfig as Config };
