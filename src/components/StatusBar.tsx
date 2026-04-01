import React from "react";
import { Box, Text } from "ink";
import type { AppState } from "../types.js";

export function StatusBar({ state }: { state: AppState }) {
  const hasCtx = state.targetUserId ? Boolean(state.contextTokens[state.targetUserId]) : false;
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text dimColor>
        {hasCtx ? <Text color="green">● ready</Text> : <Text color="yellow">◌ waiting for context</Text>}
        <Text> │ </Text>
        <Text>{state.showRawJson ? "RAW:on" : ""}</Text>
      </Text>
      <Text dimColor>
        /help for commands │ Tab to complete
      </Text>
    </Box>
  );
}
