import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../types.js";

export function MessageRow({ message }: { message: Message }) {
  if (message.direction === "system") {
    return (
      <Box>
        <Text dimColor>  {message.text}</Text>
      </Box>
    );
  }

  const isIn = message.direction === "in";
  const arrow = isIn ? "◀" : "▶";
  const color = isIn ? "yellow" : "green";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{arrow}</Text>
        <Text> </Text>
        {isIn && message.from && <Text color="yellow">{message.from} </Text>}
        <Text dimColor>{message.time}</Text>
      </Box>
      <Text>  {message.text}</Text>
      {message.filePath && <Text dimColor>  → {message.filePath}</Text>}
    </Box>
  );
}
