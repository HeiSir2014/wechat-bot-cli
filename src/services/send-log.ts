import fs from "node:fs";
import path from "node:path";
import type { SendLogEntry, SendStatus } from "../types.js";

const LOG_DIR = path.join(import.meta.dir, "..", "..", ".send-logs");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logFilePath(date?: Date): string {
  const d = date ?? new Date();
  const day = d.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `send-${day}.jsonl`);
}

/** Append a send log entry to today's JSONL file. */
export function appendSendLog(entry: SendLogEntry): void {
  ensureLogDir();
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(logFilePath(), line, "utf-8");
}

/** Update an existing entry in today's log by rewriting the file. */
export function updateSendLog(id: string, update: Partial<SendLogEntry>): void {
  const fp = logFilePath();
  if (!fs.existsSync(fp)) return;
  const lines = fs.readFileSync(fp, "utf-8").split("\n").filter(Boolean);
  const updated = lines.map((line) => {
    try {
      const entry: SendLogEntry = JSON.parse(line);
      if (entry.id === id) return JSON.stringify({ ...entry, ...update });
      return line;
    } catch {
      return line;
    }
  });
  fs.writeFileSync(fp, updated.join("\n") + "\n", "utf-8");
}

/** Read all entries from a specific day's log. */
export function readDayLog(date?: Date): SendLogEntry[] {
  const fp = logFilePath(date);
  if (!fs.existsSync(fp)) return [];
  return fs
    .readFileSync(fp, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SendLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is SendLogEntry => e !== null);
}

/** Get failed entries from recent days (default: today + yesterday). */
export function getFailedEntries(days = 2): SendLogEntry[] {
  const results: SendLogEntry[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    results.push(...readDayLog(d).filter((e) => e.status === "failed"));
  }
  return results;
}

/** Get entries with a specific status from recent days. */
export function getEntriesByStatus(status: SendStatus, days = 2): SendLogEntry[] {
  const results: SendLogEntry[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    results.push(...readDayLog(d).filter((e) => e.status === status));
  }
  return results;
}

/** Get a single entry by ID from recent days. */
export function getEntryById(id: string, days = 7): SendLogEntry | undefined {
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const found = readDayLog(d).find((e) => e.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Summary stats for display. */
export function getSendStats(days = 1): { total: number; sent: number; failed: number; pending: number } {
  let total = 0, sent = 0, failed = 0, pending = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    for (const e of readDayLog(d)) {
      total++;
      if (e.status === "sent") sent++;
      else if (e.status === "failed") failed++;
      else pending++;
    }
  }
  return { total, sent, failed, pending };
}
