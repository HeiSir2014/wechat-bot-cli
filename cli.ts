#!/usr/bin/env bun
/**
 * WeChat Bot CLI — TUI powered by Ink (React for CLI).
 *
 * Usage:
 *   bun start                       # QR scan login (or reuse saved token)
 *   bun start -- --token <token>    # Pass token directly
 *   bun start -- --login            # Force re-login
 */

import React from "react";
import { render } from "ink";
import { App } from "./src/app.js";
import { loadState, saveState } from "./src/services/state.js";

// Parse args
const args = process.argv.slice(2);
let argToken: string | undefined;
let forceLogin = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--token" && args[i + 1]) argToken = args[++i];
  else if (args[i] === "--login") forceLogin = true;
}

// If --token provided, save it before rendering
if (argToken) {
  const state = loadState();
  state.token = argToken;
  saveState(state);
}

render(React.createElement(App, { forceLogin }));
