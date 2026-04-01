import React from "react";
import { Box, Text } from "ink";

export function CompletionPopup({ items, selectedIndex }: { items: string[]; selectedIndex: number }) {
  if (items.length === 0) return null;

  return (
    <Box paddingX={1} gap={1} flexWrap="wrap">
      {items.map((item, i) => (
        <Text key={item} color={i === selectedIndex ? "cyan" : "gray"} inverse={i === selectedIndex}>
          {" "}{item}{" "}
        </Text>
      ))}
    </Box>
  );
}
