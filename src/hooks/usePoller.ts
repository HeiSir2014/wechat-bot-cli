import { useEffect, useRef } from "react";
import { getUpdates } from "weixin/src/api/api.js";
import { MessageType, MessageState, MessageItemType } from "weixin/src/api/types.js";
import type { AppAction, Message } from "../types.js";
import { downloadInboundMedia, formatItem } from "../services/media.js";

function nowTime(): string {
  return new Date().toLocaleTimeString();
}

function logTs(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

let msgCounter = 0;

export function usePoller(
  token: string | null,
  baseUrl: string,
  getUpdatesBuf: string,
  dispatch: React.Dispatch<AppAction>,
) {
  const bufRef = useRef(getUpdatesBuf);
  bufRef.current = getUpdatesBuf;
  // Dedup: track seen message_ids to prevent duplicate dispatch
  const seenRef = useRef(new Set<number>());

  useEffect(() => {
    if (!token) return;
    let active = true;

    dispatch({ type: "SET_CONNECTION_STATUS", status: "polling" });

    (async () => {
      while (active) {
        try {
          const reqBuf = bufRef.current;
          console.log(`${logTs()} [getUpdates] >>> request | buf=${reqBuf ? reqBuf.slice(0, 32) + "..." : "(empty)"}`);

          const resp = await getUpdates({
            baseUrl,
            token,
            get_updates_buf: reqBuf,
          });

          const msgCount = resp.msgs?.length ?? 0;
          const newBuf = resp.get_updates_buf;
          console.log(
            `${logTs()} [getUpdates] <<< response | errcode=${resp.errcode ?? "none"} | msgs=${msgCount}` +
            ` | buf_changed=${newBuf && newBuf !== reqBuf}` +
            ` | new_buf=${newBuf ? newBuf.slice(0, 32) + "..." : "(same)"}` +
            ` | active=${active}`,
          );
          if (msgCount > 0) {
            for (const msg of resp.msgs!) {
              console.log(
                `${logTs()} [getUpdates]   msg | id=${msg.message_id} | type=${msg.message_type}` +
                ` | state=${msg.message_state} | from=${msg.from_user_id}` +
                ` | items=${msg.item_list?.length ?? 0}` +
                ` | context_token=${msg.context_token ? msg.context_token.slice(0, 16) + "..." : "none"}` +
                ` | time=${msg.create_time_ms ? new Date(msg.create_time_ms).toISOString() : "unknown"}`,
              );
            }
          }

          if (!active) {
            console.log(`${logTs()} [getUpdates] poller inactive after response, breaking`);
            break;
          }

          if (resp.errcode === -14) {
            console.log(`${logTs()} [getUpdates] session expired (errcode=-14), redirecting to login`);
            dispatch({ type: "SET_CONNECTION_STATUS", status: "expired" });
            dispatch({
              type: "ADD_MESSAGE",
              message: { id: `sys-${++msgCounter}`, direction: "system", text: "Session expired. Redirecting to login...", time: nowTime() },
            });
            dispatch({ type: "SET_SCREEN", screen: "login" });
            break;
          }

          dispatch({ type: "SET_CONNECTION_STATUS", status: "connected" });

          if (resp.get_updates_buf) {
            bufRef.current = resp.get_updates_buf; // Immediately update ref so next iteration uses latest buf
            dispatch({ type: "SET_UPDATES_BUF", buf: resp.get_updates_buf });
          }

          for (const msg of resp.msgs ?? []) {
            if (msg.message_type === MessageType.BOT) continue;
            if (msg.message_state === MessageState.GENERATING) continue;
            // Dedup by message_id
            if (msg.message_id && seenRef.current.has(msg.message_id)) continue;
            if (msg.message_id) {
              seenRef.current.add(msg.message_id);
              // Keep set bounded (last 1000 ids)
              if (seenRef.current.size > 1000) {
                const first = seenRef.current.values().next().value;
                if (first !== undefined) seenRef.current.delete(first);
              }
            }

            const items = msg.item_list ?? [];
            const text = items.map(formatItem).join(" ");
            const time = msg.create_time_ms ? new Date(msg.create_time_ms).toLocaleTimeString() : nowTime();

            // Download media
            let filePath: string | undefined;
            for (const item of items) {
              if (item.type && item.type !== MessageItemType.TEXT) {
                filePath = await downloadInboundMedia(item);
              }
            }

            const message: Message = {
              id: `in-${++msgCounter}`,
              direction: "in",
              from: msg.from_user_id,
              text,
              time,
              filePath,
              rawJson: msg,
              items,
            };
            dispatch({ type: "ADD_MESSAGE", message });

            // Update context token
            if (msg.from_user_id && msg.context_token) {
              dispatch({ type: "UPDATE_CONTEXT_TOKEN", userId: msg.from_user_id, token: msg.context_token });
            }
          }
        } catch (err) {
          console.log(`${logTs()} [getUpdates] !!! error | name=${(err as Error).name} | message=${(err as Error).message} | active=${active}`);
          if (!active) break;
          if ((err as Error).name === "AbortError") continue;
          dispatch({
            type: "ADD_MESSAGE",
            message: { id: `sys-${++msgCounter}`, direction: "system", text: `Poll error: ${(err as Error).message}`, time: nowTime() },
          });
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();

    return () => { active = false; };
  }, [token, baseUrl]);
}
