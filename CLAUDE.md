# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Server Manager is a web-based GUI for managing Model Context Protocol (MCP) servers in Claude Desktop and Cursor. Users toggle MCP servers on/off via a browser UI, and changes are written to the respective app config files.

## Commands

- `npm start` — Start the Express server (port 3456 by default, configurable via `PORT` env var)
- `npm run dev` — Start with nodemon for auto-reload during development
- No test suite exists yet (`npm test` is a placeholder)

## Architecture

This is an ES module (`"type": "module"`) Node.js app with a vanilla JS frontend. No build step required.

### Backend (Express)

- **server.js** — Entry point. Sets up Express with JSON/URL-encoded body parsing, mounts API routes at `/api`, and serves static files from the project root directory.
- **routes.js** — All API endpoints. Reads/writes MCP config files for Claude Desktop and Cursor based on OS-specific paths (`getConfigPaths()`). Key endpoints:
  - `GET /api/cursor-config` — Returns merged config (local `config.json` defaults + Cursor's saved config)
  - `GET /api/claude-config` — Returns Claude Desktop's config as-is
  - `GET /api/tools` — Returns tools from enabled servers (currently only hardcoded `mcp-manager` tool)
  - `POST /api/save-configs` — Writes full config to Cursor settings (if enabled) and filtered config (disabled servers + internal metadata removed) to Claude Desktop's config file.
  - `GET /api/settings` — Returns app settings from `settings.json`
  - `POST /api/settings` — Saves app settings to `settings.json`

### Frontend (Vanilla JS)

- **index.html** — Single page with Servers and Tools tab views
- **app.js** — Client-side logic. Fetches configs, renders server cards with toggle switches, handles save. All functions exposed on `window` for inline HTML event handlers.
- **styles.css** — Styling

### MCP Server (`mcp-server.js`)

A separate MCP server (using `@modelcontextprotocol/sdk`) that exposes a `launch_manager` tool via stdio transport. When invoked, it spawns `server.js` as a child process. This file is the entry point when this project is registered as an MCP server itself. Note: `@modelcontextprotocol/sdk` is not in `package.json` dependencies — it must be installed separately or this file is used in a context where the SDK is available.

## Config Files

- **config.json** (gitignored) — Local default server definitions, created by copying `config.example.json`
- **settings.json** (gitignored) — App settings (e.g., Cursor integration toggle). Created automatically on first save; defaults to `{ cursorIntegration: { enabled: true } }` when absent.
- Claude Desktop config path: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- Cursor config path: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` (macOS)
- Windows and Linux paths are also handled in `routes.js:getConfigPaths()`

## Key Patterns

- Server enable/disable uses a `disabled` boolean property on each server object. When saving to Claude Desktop, disabled servers are stripped entirely from the output config.
- Internal metadata properties (`disabled`, `custom`, `_removedFromDefaults`) are stripped when writing to Claude Desktop's config via `filterDisabledServers()`.
- Config merging (3-way): default servers from `config.json` are merged with Cursor saved config (if enabled) and Claude Desktop config, with saved values taking precedence. Servers can be marked `custom: true` if not present in defaults.
- Removed default servers are tracked via `_removedDefaults` array in the Cursor config file so they don't reappear on reload.
- **Cursor integration toggle**: When disabled via settings, the backend skips reading/writing Cursor's config file entirely and uses only Claude Desktop config + defaults.
