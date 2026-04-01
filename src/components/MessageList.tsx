import React from "react";
import { Box, Text, useStdout } from "ink";
import type { Message } from "../types.js";
import { MessageRow } from "./MessageRow.js";

export function MessageList({ messages }: { messages: Message[] }) {
  const { stdout } = useStdout();
  // Reserve rows for header (3) + status (1) + input (2) + completion (2)
  const maxVisible = Math.max(5, (stdout?.rows ?? 24) - 8);
  const visible = messages.slice(-maxVisible);

  if (visible.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Text dimColor>Waiting for messages... Send a message from WeChat to start.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((msg) => (
        <MessageRow key={msg.id} message={msg} />
      ))}
    </Box>
  );
}
