/** Color theme for the TUI. */
export const theme = {
  // Message directions
  inbound: "yellow" as const,
  outbound: "green" as const,
  system: "gray" as const,

  // UI elements
  command: "cyan" as const,
  error: "red" as const,
  success: "green" as const,
  warning: "yellow" as const,
  dim: "gray" as const,
  accent: "magenta" as const,
  highlight: "white" as const,

  // Prompt
  prompt: "green" as const,

  // Status
  connected: "green" as const,
  expired: "red" as const,
  polling: "yellow" as const,
};
