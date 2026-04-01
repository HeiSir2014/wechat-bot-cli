import React from "react";
import { Box, Text } from "ink";
import type { AppState } from "../types.js";

export function Header({ state }: { state: AppState }) {
  const statusColor = state.connectionStatus === "connected" ? "green"
    : state.connectionStatus === "expired" ? "red"
    : "yellow";
  const statusIcon = state.connectionStatus === "connected" ? "●"
    : state.connectionStatus === "expired" ? "✗"
    : "◌";

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text>
        <Text bold color="cyan">WeChat Bot</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{state.accountId ?? "not logged in"}</Text>
      </Text>
      <Text>
        <Text dimColor>Target: </Text>
        <Text color="yellow">{state.targetUserId ?? "none"}</Text>
        <Text dimColor> │ </Text>
        <Text color={statusColor}>{statusIcon} {state.connectionStatus}</Text>
      </Text>
    </Box>
  );
}
