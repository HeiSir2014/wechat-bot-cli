#!/usr/bin/env bun
/**
 * Readable log viewer. Reads JSONL logs and prints human-readable output.
 * Usage:
 *   bun run logs.ts            # Show today's logs
 *   bun run logs.ts --follow   # Tail -f style
 */

import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(import.meta.dir, "logs");
const follow = process.argv.includes("--follow") || process.argv.includes("-f");

function todayLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `openclaw-${date}.log`);
}

function formatLine(line: string): string | null {
  try {
    const entry = JSON.parse(line);
    const time = (entry.time as string)?.slice(11, 19) ?? "";
    const level = (entry._meta?.logLevelName as string) ?? "INFO";
    const msg = (entry["1"] as string) ?? "";
    const color = level === "ERROR" ? "\x1b[31m" : level === "WARN" ? "\x1b[33m" : level === "DEBUG" ? "\x1b[90m" : "";
    const reset = color ? "\x1b[0m" : "";
    return `${color}${time} [${level.padEnd(5)}] ${msg}${reset}`;
  } catch {
    return null;
  }
}

function printFile(filePath: string, offset = 0): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.slice(offset).split("\n").filter(Boolean);
  for (const line of lines) {
    const formatted = formatLine(line);
    if (formatted) console.log(formatted);
  }
  return content.length;
}

const logPath = todayLogPath();
let pos = 0;

if (!follow) {
  printFile(logPath);
  process.exit(0);
}

// --follow mode
console.log(`\x1b[90mTailing ${logPath}...\x1b[0m\n`);
pos = printFile(logPath);

setInterval(() => {
  pos = printFile(logPath, pos);
}, 1000);
