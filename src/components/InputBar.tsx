import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { CompletionPopup } from "./CompletionPopup.js";
import { getCompletions } from "../hooks/useCompletion.js";

type Props = {
  onSubmit: (line: string) => void;
};

export function InputBar({ onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [completions, setCompletions] = useState<string[]>([]);
  const [compIdx, setCompIdx] = useState(0);
  const [history] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const clearCompletions = useCallback(() => {
    setCompletions([]);
    setCompIdx(0);
  }, []);

  useInput((input, key) => {
    if (key.return) {
      if (value.trim()) {
        history.unshift(value);
        onSubmit(value);
      }
      setValue("");
      clearCompletions();
      setHistIdx(-1);
      return;
    }

    if (key.tab) {
      if (completions.length > 0) {
        // Cycle through completions
        const next = (compIdx + 1) % completions.length;
        setCompIdx(next);
        setValue(completions[next]!);
      } else {
        const candidates = getCompletions(value);
        if (candidates.length === 1) {
          // Inline complete
          setValue(candidates[0]!);
          clearCompletions();
        } else if (candidates.length > 1) {
          setCompletions(candidates);
          setCompIdx(0);
          setValue(candidates[0]!);
        }
      }
      return;
    }

    if (key.escape) {
      clearCompletions();
      return;
    }

    if (key.upArrow) {
      if (history.length > 0 && histIdx < history.length - 1) {
        const next = histIdx + 1;
        setHistIdx(next);
        setValue(history[next]!);
      }
      clearCompletions();
      return;
    }

    if (key.downArrow) {
      if (histIdx > 0) {
        const next = histIdx - 1;
        setHistIdx(next);
        setValue(history[next]!);
      } else if (histIdx === 0) {
        setHistIdx(-1);
        setValue("");
      }
      clearCompletions();
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      clearCompletions();
      return;
    }

    // Ctrl+C is handled by Ink's app exit
    // Ctrl+U: clear line
    if (input === "\u0015") {
      setValue("");
      clearCompletions();
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
      clearCompletions();
    }
  });

  return (
    <Box flexDirection="column">
      {completions.length > 1 && (
        <CompletionPopup items={completions.map((c) => {
          // Show just the last segment for readability
          const parts = c.split(" ");
          return parts[parts.length - 1] ?? c;
        })} selectedIndex={compIdx} />
      )}
      <Box>
        <Text color="green" bold>❯ </Text>
        <Text>{value}</Text>
        <Text dimColor>█</Text>
      </Box>
    </Box>
  );
}
