# MCP Server Manager

A native desktop app for managing Model Context Protocol (MCP) servers in Claude Desktop and Cursor. Enable/disable servers, add custom ones, and sync configurations — all from a clean GUI without touching JSON files manually.

Built with [Tauri v2](https://v2.tauri.app/) (Rust + WebView) and vanilla JS. No browser required.

![MCP Server Manager Interface](https://github.com/MediaPublishing/mcp-manager/blob/main/MCP-Server-Manager.png?raw=true)

## Features

- 🎛️ Enable/disable MCP servers with simple toggle switches
- ➕ Add, edit, and remove custom MCP servers via a modal UI
- 🔄 Changes are synced between Claude Desktop and Cursor
- ⚙️ Toggle Cursor integration on/off from the Settings panel
- 🛠️ View available tools for each enabled server
- 🗑️ Remove/disable servers with full definitions preserved for later restoration
- 💾 Local config storage keeps server definitions even when disabled or deleted
- 🔒 Secure handling of environment variables and API keys
- 🖥️ Native desktop app — launch from Dock/taskbar, no terminal needed

## Prerequisites

- **macOS** (primary), Windows, or Linux
- [Rust](https://rustup.rs/) — required to build the Tauri app

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/mcp-manager.git
cd mcp-manager
```

2. Install Node dependencies:
```bash
npm install
```

3. Start in development mode:
```bash
npm run dev
```

The app window opens automatically. First launch downloads and compiles Rust dependencies — this takes a few minutes. Subsequent launches are fast.

## Build a distributable app

```bash
npm run build
```

Produces a `.app` bundle and `.dmg` installer on macOS (located in `src-tauri/target/release/bundle/`).

## Configuration

MCP Server Manager reads and writes the following files:

| File | Purpose |
|------|---------|
| `config.example.json` | Bundled default server definitions (read-only) |
| `~/Library/Application Support/com.mcp-manager.app/config.json` | Local server registry — stores disabled/deleted servers and their definitions |
| `~/Library/Application Support/com.mcp-manager.app/settings.json` | App settings (Cursor integration toggle) — created automatically |
| `~/Library/Application Support/Claude/claude_desktop_config.json` | Claude Desktop config (macOS) |
| `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | Cursor config (macOS) |

Windows and Linux paths are handled automatically.

### Example server definition

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

## Usage

1. Launch the app (`npm run dev` or open the built `.app`)
2. Toggle servers on/off with the switches on each card — disabled servers remain in local config for easy re-enabling
3. Click **+ Add Server** to add a custom MCP server
4. Use **Edit** / **Remove** buttons to manage existing servers
5. Deleted servers are preserved in local config and can be restored later
6. Expand **Settings** to toggle Cursor integration
7. Click **Save Changes** — Claude Desktop config is updated immediately
8. Restart Claude Desktop to activate the new configuration

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT — see [LICENSE](LICENSE) for details.
