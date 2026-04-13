import fs from "node:fs";
import path from "node:path";

const COMMANDS: Record<string, string> = {
  "/help": "Show commands",
  "/send": "Send text",
  "/file": "Send file",
  "/image": "Send image",
  "/video": "Send video",
  "/voice": "Send audio file",
  "/tts": "TTS config/send",
  "/to": "Set target user",
  "/info": "Session info",
  "/raw": "Toggle raw JSON",
  "/failed": "Show failed msgs",
  "/retry": "Retry failed msg",
  "/stats": "Send statistics",
  "/login": "Re-login",
  "/quit": "Exit",
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
export const COMMAND_ENTRIES = Object.entries(COMMANDS);
const FILE_COMMANDS = new Set(["/file", "/image", "/video", "/voice"]);
const ARG_COMMANDS = new Set([...FILE_COMMANDS, "/send", "/to", "/tts", "/retry"]);

function completeFilePath(partial: string): string[] {
  const cwd = process.cwd();
  try {
    let dir: string;
    let prefix: string;
    if (!partial) { dir = cwd; prefix = ""; }
    else {
      const expanded = partial.startsWith("~")
        ? path.join(process.env.HOME ?? "/root", partial.slice(1))
        : path.resolve(cwd, partial);
      if (partial.endsWith("/") || (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory())) {
        dir = expanded; prefix = "";
      } else {
        dir = path.dirname(expanded); prefix = path.basename(expanded).toLowerCase();
      }
    }
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((e) => !e.startsWith("."))
      .filter((e) => !prefix || e.toLowerCase().startsWith(prefix))
      .map((e) => {
        const isDir = fs.statSync(path.join(dir, e)).isDirectory();
        const base = partial ? (partial.endsWith("/") ? partial : (partial.includes("/") ? partial.slice(0, partial.lastIndexOf("/") + 1) : "")) : "";
        return `${base}${e}${isDir ? "/" : ""}`;
      });
  } catch { return []; }
}

export function getCompletions(line: string): string[] {
  // File path completion: "/file ./pa" → paths
  const fileMatch = line.match(/^\/(file|image|video|voice)(\s+)([\s\S]*)/);
  if (fileMatch) {
    const cmd = `/${fileMatch[1]}`;
    const space = fileMatch[2];
    const partial = fileMatch[3];
    return completeFilePath(partial).map((p) => `${cmd}${space}${p}`);
  }

  // Command completion: "/fi" → "/file "
  if (line.startsWith("/")) {
    const hits = COMMAND_NAMES.filter((c) => c.startsWith(line.toLowerCase()));
    return hits.map((h) => ARG_COMMANDS.has(h) ? `${h} ` : h);
  }

  return [];
}
