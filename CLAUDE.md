# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Server Manager is a **Tauri v2 desktop app** for managing Model Context Protocol (MCP) servers in Claude Desktop and Cursor. Users toggle MCP servers on/off via the app UI, and changes are written directly to the respective config files using Tauri's filesystem plugin — no Express server involved.

## Commands

- `npm run dev` — Start the Tauri dev window (runs `tauri dev`)
- `npm run build` — Build a distributable `.app` / `.dmg` (runs `tauri build`)
- No test suite exists yet (`npm test` is a placeholder)
- **Rust is required**: install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

## Architecture

```
Tauri Webview (index.html + backend.js + app.js)
    └── window.__TAURI__.core.invoke('plugin:fs|...') → tauri-plugin-fs → Config files
```

No build step for the frontend. No Express server. No `fetch()` calls.

### Frontend (Vanilla JS)

- **index.html** — Single page with Servers and Tools tab views
- **backend.js** — Replaces `routes.js`. All file I/O via Tauri IPC (`window.__TAURI__`). Exposes a `Backend` global with: `init()`, `getMergedConfig()`, `getTools()`, `saveConfigs()`, `readSettings()`, `writeSettings()`, `readDefaultConfig()`
- **app.js** — UI logic. Calls `Backend.*` instead of `fetch()`. All functions exposed on `window` for inline HTML event handlers.
- **styles.css** — Styling

### Tauri (Rust — zero custom commands)

- **src-tauri/src/lib.rs** — Registers `tauri-plugin-fs`. Only Rust file that matters.
- **src-tauri/tauri.conf.json** — App config: 1000×700 window, `withGlobalTauri: true`, bundles `config.example.json` as a resource, `frontendDist: "../"` serves project root.
- **src-tauri/capabilities/default.json** — Filesystem allow-lists for Claude/Cursor config dirs on macOS, Windows, and Linux.
- **src-tauri/Cargo.toml** — Dependencies: `tauri = "2"`, `tauri-plugin-fs = "2"`.

### Tauri JS API usage in `backend.js`

```js
// File reads/writes — calls tauri-plugin-fs via IPC
window.__TAURI__.core.invoke('plugin:fs|read_text_file', { path })
window.__TAURI__.core.invoke('plugin:fs|write_text_file', { path, contents })
window.__TAURI__.core.invoke('plugin:fs|mkdir', { path, options: { recursive: true } })

// Path helpers (async — call into Rust)
window.__TAURI__.path.homeDir()      // e.g. /Users/alice
window.__TAURI__.path.appDataDir()   // e.g. ~/Library/Application Support/com.mcp-manager.app/
window.__TAURI__.path.resourceDir()  // location of bundled config.example.json
```

`withGlobalTauri: true` in `tauri.conf.json` is what makes `window.__TAURI__` available without a bundler.

## Config Files

- **config.example.json** — Bundled as a Tauri resource (read-only). Used as the source of default server definitions. Previously users copied this to `config.json`; that step is no longer needed.
- **settings.json** — Written to `appDataDir()` (e.g. `~/Library/Application Support/com.mcp-manager.app/settings.json`). Created automatically on first save; defaults to `{ cursorIntegration: { enabled: true } }` when absent.
- Claude Desktop config: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- Cursor config: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` (macOS)
- Windows and Linux paths are handled in `backend.js:getConfigPaths()`

## Key Patterns

- Server enable/disable uses a `disabled` boolean on each server object. When saving to Claude Desktop, disabled servers are stripped entirely from the output config.
- Internal metadata properties (`disabled`, `custom`, `_removedFromDefaults`) are stripped when writing to Claude Desktop's config via `filterDisabledServers()`.
- Config merging (3-way): default servers from `config.example.json` are merged with Cursor saved config (if enabled) and Claude Desktop config, with saved values taking precedence. Servers not in defaults are marked `custom: true`.
- Removed default servers are tracked via `_removedDefaults` array in the Cursor config file so they don't reappear on reload.
- **Cursor integration toggle**: When disabled, `backend.js` skips reading/writing Cursor's config file entirely and uses only Claude Desktop config + defaults.
- **First launch**: `getSettingsPath()` calls `mkdirRecursive(appDataDir())` before writing, ensuring the directory exists.
