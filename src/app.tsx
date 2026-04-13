import React, { useReducer, useCallback, useEffect } from "react";
import { Box, useApp } from "ink";
import type { AppState, AppAction, Message } from "./types.js";
import { buildInitialAppState, loadStateWithFallback, persistAppState, getApiOpts } from "./services/state.js";
import { sendText, sendImage, sendVideo, sendFile, sendVoice, resendText } from "./services/api.js";
import { ttsAndSendFile, TTS_VOICE_CATALOG, findVoice } from "./services/tts.js";
import { resolveFilePath } from "./services/media.js";
import { COMMAND_ENTRIES } from "./hooks/useCompletion.js";
import { getFailedEntries, getSendStats } from "./services/send-log.js";
import { usePoller } from "./hooks/usePoller.js";
import { Header } from "./components/Header.js";
import { MessageList } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputBar } from "./components/InputBar.js";
import { LoginScreen } from "./components/LoginScreen.js";
import fs from "node:fs";

let msgId = 1000;
function sysMsg(text: string): Message {
  return { id: `sys-${++msgId}`, direction: "system", text, time: new Date().toLocaleTimeString() };
}
function outMsg(text: string): Message {
  return { id: `out-${++msgId}`, direction: "out", text, time: new Date().toLocaleTimeString() };
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_TOKEN":
      return {
        ...state,
        token: action.token,
        baseUrl: action.baseUrl ?? state.baseUrl,
        accountId: action.accountId ?? state.accountId,
        userId: action.userId ?? state.userId,
        targetUserId: action.userId ?? state.targetUserId,
        getUpdatesBuf: "",
        contextTokens: {},
        connectionStatus: "polling",
      };
    case "SET_TARGET":
      return { ...state, targetUserId: action.userId };
    case "SET_SCREEN":
      return { ...state, screen: action.screen };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "UPDATE_CONTEXT_TOKEN":
      return {
        ...state,
        contextTokens: { ...state.contextTokens, [action.userId]: action.token },
        targetUserId: state.targetUserId ?? action.userId,
      };
    case "SET_UPDATES_BUF":
      return { ...state, getUpdatesBuf: action.buf };
    case "SET_CONNECTION_STATUS":
      return { ...state, connectionStatus: action.status };
    case "TOGGLE_RAW":
      return { ...state, showRawJson: !state.showRawJson };
    case "SET_TTS_CONFIG":
      return { ...state, ttsConfig: { ...state.ttsConfig, ...action.config } };
    case "CLEAR_SESSION":
      return { ...state, getUpdatesBuf: "", contextTokens: {}, messages: [] };
    default:
      return state;
  }
}

export function App({ forceLogin }: { forceLogin?: boolean }) {
  const saved = loadStateWithFallback();
  const [state, dispatch] = useReducer(appReducer, buildInitialAppState(saved));
  const { exit } = useApp();

  // Persist state on changes
  useEffect(() => {
    persistAppState(state);
  }, [state.token, state.targetUserId, state.contextTokens, state.getUpdatesBuf, state.ttsConfig]);

  // Start poller
  usePoller(
    state.screen === "chat" ? state.token : null,
    state.baseUrl,
    state.getUpdatesBuf,
    dispatch,
  );

  const handleCommand = useCallback(async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const spaceIdx = trimmed.indexOf(" ");
    const cmd = trimmed.startsWith("/") ? (spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed).toLowerCase() : null;
    const args = cmd && spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

    const target = state.targetUserId;
    const ctx = target ? state.contextTokens[target] : undefined;
    const opts = getApiOpts(state);

    const requireCtx = () => {
      if (!target) throw new Error("No target. Use /to <userId>");
      if (!ctx) throw new Error("No context token. Wait for inbound message first.");
      return { target, ctx };
    };

    const addResult = (r: { ok: boolean; detail?: string; error?: string }) => {
      dispatch({ type: "ADD_MESSAGE", message: sysMsg(r.ok ? `✓ ${r.detail}` : `✗ ${r.error}`) });
    };

    switch (cmd) {
      case "/quit":
      case "/exit":
        exit();
        return;

      case "/help":
        dispatch({ type: "ADD_MESSAGE", message: sysMsg("─── Commands ───") });
        for (const [c, desc] of COMMAND_ENTRIES) {
          dispatch({ type: "ADD_MESSAGE", message: sysMsg(`  ${c.padEnd(10)} ${desc}`) });
        }
        dispatch({ type: "ADD_MESSAGE", message: sysMsg("  <text>     Send text directly") });
        return;

      case "/info":
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`account: ${state.accountId ?? "-"}`) });
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`target: ${state.targetUserId ?? "-"}`) });
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`context: ${ctx ? "ready" : "waiting"}`) });
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`status: ${state.connectionStatus}`) });
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`tts voice: ${state.ttsConfig.voice}`) });
        return;

      case "/raw":
        dispatch({ type: "TOGGLE_RAW" });
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Raw JSON: ${!state.showRawJson ? "ON" : "OFF"}`) });
        return;

      case "/to":
        if (!args) { dispatch({ type: "ADD_MESSAGE", message: sysMsg("Usage: /to <userId>") }); return; }
        dispatch({ type: "SET_TARGET", userId: args });
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Target → ${args}`) });
        return;

      case "/send":
        if (!args) { dispatch({ type: "ADD_MESSAGE", message: sysMsg("Usage: /send <text>") }); return; }
        try {
          const { target: t, ctx: c } = requireCtx();
          dispatch({ type: "ADD_MESSAGE", message: outMsg(args) });
          addResult(await sendText(opts, t, c, args));
        } catch (e) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ ${(e as Error).message}`) }); }
        return;

      case "/file":
      case "/image":
      case "/video":
      case "/voice": {
        if (!args) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Usage: ${cmd} <path>`) }); return; }
        const fp = resolveFilePath(args);
        if (!fs.existsSync(fp)) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ Not found: ${fp}`) }); return; }
        try {
          const { target: t, ctx: c } = requireCtx();
          const fn = cmd === "/image" ? sendImage : cmd === "/video" ? sendVideo : cmd === "/voice" ? sendVoice : sendFile;
          addResult(await fn(opts, t, c, fp));
        } catch (e) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ ${(e as Error).message}`) }); }
        return;
      }

      case "/tts": {
        if (!args) {
          const entry = TTS_VOICE_CATALOG.find((v) => v.id === state.ttsConfig.voice);
          dispatch({ type: "ADD_MESSAGE", message: sysMsg(`TTS: ${entry?.name ?? state.ttsConfig.voice} | rate:${state.ttsConfig.rate} pitch:${state.ttsConfig.pitch}`) });
          dispatch({ type: "ADD_MESSAGE", message: sysMsg("Usage: /tts <text> | /tts list | /tts voice <name> | /tts rate/pitch/volume/proxy <val>") });
          return;
        }
        const sub = args.split(/\s+/);
        const subCmd = sub[0]?.toLowerCase();
        const subArg = sub.slice(1).join(" ").trim();

        if (subCmd === "list" || subCmd === "ls") {
          for (const v of TTS_VOICE_CATALOG) {
            const active = v.id === state.ttsConfig.voice ? " ◀" : "";
            dispatch({ type: "ADD_MESSAGE", message: sysMsg(`${v.gender === "F" ? "♀" : "♂"} ${v.name.padEnd(14)} ${v.style}${active}`) });
          }
          return;
        }
        if (subCmd === "voice" || subCmd === "v") {
          if (!subArg) { dispatch({ type: "ADD_MESSAGE", message: sysMsg("Usage: /tts voice <name>") }); return; }
          const matched = findVoice(subArg);
          if (!matched) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ Unknown voice. /tts list`) }); return; }
          dispatch({ type: "SET_TTS_CONFIG", config: { voice: matched.id } });
          dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Voice → ${matched.name} (${matched.style})`) });
          return;
        }
        if (subCmd === "rate" || subCmd === "r") { dispatch({ type: "SET_TTS_CONFIG", config: { rate: subArg || "default" } }); dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Rate → ${subArg || "default"}`) }); return; }
        if (subCmd === "pitch" || subCmd === "p") { dispatch({ type: "SET_TTS_CONFIG", config: { pitch: subArg || "default" } }); dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Pitch → ${subArg || "default"}`) }); return; }
        if (subCmd === "volume" || subCmd === "vol") { dispatch({ type: "SET_TTS_CONFIG", config: { volume: subArg || "default" } }); dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Volume → ${subArg || "default"}`) }); return; }
        if (subCmd === "proxy") {
          const val = subArg === "off" || subArg === "none" ? "" : subArg;
          dispatch({ type: "SET_TTS_CONFIG", config: { proxy: val } });
          dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Proxy → ${val || "(none)"}`) });
          return;
        }

        // Default: TTS and send
        try {
          const { target: t, ctx: c } = requireCtx();
          addResult(await ttsAndSendFile(opts, t, c, args, state.ttsConfig, (msg) => {
            dispatch({ type: "ADD_MESSAGE", message: sysMsg(msg) });
          }));
        } catch (e) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ ${(e as Error).message}`) }); }
        return;
      }

      case "/failed": {
        const failed = getFailedEntries(7);
        if (failed.length === 0) {
          dispatch({ type: "ADD_MESSAGE", message: sysMsg("No failed messages in the last 7 days.") });
        } else {
          dispatch({ type: "ADD_MESSAGE", message: sysMsg(`─── Failed Messages (${failed.length}) ───`) });
          for (const e of failed.slice(-20)) {
            const preview = e.payload.length > 40 ? e.payload.slice(0, 40) + "…" : e.payload;
            dispatch({
              type: "ADD_MESSAGE",
              message: sysMsg(`  [${e.id.slice(-8)}] ${e.contentType} → ${e.toUserId.slice(0, 8)}… | ${e.error ?? "unknown"} | ${preview}`),
            });
          }
          dispatch({ type: "ADD_MESSAGE", message: sysMsg("Use /retry <id> to resend, or /retry all for all failed text messages.") });
        }
        return;
      }

      case "/retry": {
        if (!args) {
          dispatch({ type: "ADD_MESSAGE", message: sysMsg("Usage: /retry <id> | /retry all") });
          return;
        }
        try {
          const { target: t, ctx: c } = requireCtx();
          if (args === "all") {
            const failed = getFailedEntries(7).filter((e) => e.contentType === "text");
            if (failed.length === 0) {
              dispatch({ type: "ADD_MESSAGE", message: sysMsg("No failed text messages to retry.") });
              return;
            }
            dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Retrying ${failed.length} failed text messages...`) });
            let ok = 0;
            let fail = 0;
            for (const e of failed) {
              const r = await resendText(opts, e.toUserId, c, e.payload);
              if (r.ok) ok++;
              else fail++;
            }
            dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Retry done: ${ok} sent, ${fail} still failed.`) });
          } else {
            const failed = getFailedEntries(7);
            const entry = failed.find((e) => e.id.endsWith(args) || e.id === args);
            if (!entry) {
              dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ No failed message matching "${args}". Use /failed to list.`) });
              return;
            }
            if (entry.contentType !== "text") {
              dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ Only text messages can be retried via /retry. File: ${entry.payload}`) });
              return;
            }
            dispatch({ type: "ADD_MESSAGE", message: outMsg(`[retry] ${entry.payload}`) });
            addResult(await resendText(opts, entry.toUserId, c, entry.payload));
          }
        } catch (e) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ ${(e as Error).message}`) }); }
        return;
      }

      case "/stats": {
        const s = getSendStats(1);
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Today: ${s.total} sent, ${s.sent} ok, ${s.failed} failed, ${s.pending} pending`) });
        const s7 = getSendStats(7);
        dispatch({ type: "ADD_MESSAGE", message: sysMsg(`7-day: ${s7.total} sent, ${s7.sent} ok, ${s7.failed} failed`) });
        return;
      }

      case "/login":
        dispatch({ type: "SET_SCREEN", screen: "login" });
        return;

      default:
        break;
    }

    if (trimmed.startsWith("/")) {
      dispatch({ type: "ADD_MESSAGE", message: sysMsg(`Unknown command: ${trimmed.split(" ")[0]}. /help`) });
      return;
    }

    // Default: send text
    try {
      const { target: t, ctx: c } = requireCtx();
      dispatch({ type: "ADD_MESSAGE", message: outMsg(trimmed) });
      addResult(await sendText(opts, t, c, trimmed));
    } catch (e) { dispatch({ type: "ADD_MESSAGE", message: sysMsg(`✗ ${(e as Error).message}`) }); }
  }, [state, exit]);

  if (state.screen === "login" || forceLogin) {
    return <LoginScreen dispatch={dispatch} />;
  }

  return (
    <Box flexDirection="column" height="100%">
      <Header state={state} />
      <MessageList messages={state.messages} />
      <StatusBar state={state} />
      <InputBar onSubmit={handleCommand} />
    </Box>
  );
}
