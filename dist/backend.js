// backend.js — Tauri-based backend replacing routes.js
// Uses Tauri IPC (window.__TAURI__) instead of Express + Node fs.
// All functions are async and mirror the API surface of routes.js.

const Backend = (() => {
    // Cached paths — computed once during init()
    let _configPaths = null;
    let _settingsPath = null;

    // ─── Guards ───────────────────────────────────────────────────────────────

    function requireTauri() {
        if (!window.__TAURI__) {
            const msg =
                'This app must run inside Tauri. ' +
                'Use `npx tauri dev` to start in development, ' +
                'or open the bundled desktop app.';
            document.body.innerHTML =
                `<div style="padding:40px;color:red;font-family:sans-serif;">${msg}</div>`;
            throw new Error(msg);
        }
    }

    // ─── Platform helpers ────────────────────────────────────────────────────

    function isWindows() {
        return navigator.platform.toUpperCase().includes('WIN');
    }

    // Simple path join — works on all platforms because both macOS/Linux use /
    // and Windows accepts / as well in most contexts.
    function joinPath(base, ...parts) {
        const sep = isWindows() ? '\\' : '/';
        return [base, ...parts].join(sep);
    }

    // ─── Tauri fs plugin — direct IPC calls ──────────────────────────────────
    // The fs plugin is loaded in lib.rs; its commands are accessible via invoke.

    async function fsInvoke(command, args) {
        return window.__TAURI__.core.invoke(`plugin:fs|${command}`, args);
    }

    async function readTextFile(path) {
        return fsInvoke('read_text_file', { path });
    }

    async function writeTextFile(path, contents) {
        await fsInvoke('write_text_file', { path, contents });
    }

    async function mkdirRecursive(path) {
        try {
            await fsInvoke('mkdir', { path, options: { recursive: true } });
        } catch (_) {
            // Ignore — directory may already exist
        }
    }

    // ─── Path resolution ──────────────────────────────────────────────────────

    async function homeDir() {
        return window.__TAURI__.path.homeDir();
    }

    async function appDataDir() {
        return window.__TAURI__.path.appDataDir();
    }

    async function resourceDir() {
        return window.__TAURI__.path.resourceDir();
    }

    // ─── Derived paths ────────────────────────────────────────────────────────

    async function getConfigPaths() {
        if (_configPaths) return _configPaths;

        const home = await homeDir();

        if (navigator.platform.toUpperCase().includes('MAC')) {
            _configPaths = {
                CURSOR_CONFIG_PATH: joinPath(
                    home,
                    'Library', 'Application Support', 'Cursor', 'User',
                    'globalStorage', 'saoudrizwan.claude-dev', 'settings',
                    'cline_mcp_settings.json'
                ),
                CLAUDE_CONFIG_PATH: joinPath(
                    home,
                    'Library', 'Application Support', 'Claude',
                    'claude_desktop_config.json'
                )
            };
        } else if (isWindows()) {
            _configPaths = {
                CURSOR_CONFIG_PATH: joinPath(
                    home,
                    'AppData', 'Roaming', 'Cursor', 'User',
                    'globalStorage', 'saoudrizwan.claude-dev', 'settings',
                    'cline_mcp_settings.json'
                ),
                CLAUDE_CONFIG_PATH: joinPath(
                    home,
                    'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'
                )
            };
        } else {
            // Linux
            _configPaths = {
                CURSOR_CONFIG_PATH: joinPath(
                    home,
                    '.config', 'Cursor', 'User',
                    'globalStorage', 'saoudrizwan.claude-dev', 'settings',
                    'cline_mcp_settings.json'
                ),
                CLAUDE_CONFIG_PATH: joinPath(
                    home,
                    '.config', 'Claude', 'claude_desktop_config.json'
                )
            };
        }

        return _configPaths;
    }

    async function getSettingsPath() {
        if (_settingsPath) return _settingsPath;
        const appData = await appDataDir();
        await mkdirRecursive(appData); // Ensure dir exists on first launch
        _settingsPath = joinPath(appData, 'settings.json');
        return _settingsPath;
    }

    // ─── Config file helpers ──────────────────────────────────────────────────

    async function readConfigFile(filePath) {
        try {
            const data = await readTextFile(filePath);
            return JSON.parse(data);
        } catch (_) {
            // File not found or parse error — return empty config
            return { mcpServers: {} };
        }
    }

    // ─── Settings ─────────────────────────────────────────────────────────────

    async function readSettings() {
        try {
            const sp = await getSettingsPath();
            const data = await readTextFile(sp);
            return JSON.parse(data);
        } catch (_) {
            return { cursorIntegration: { enabled: true } };
        }
    }

    async function writeSettings(settings) {
        const sp = await getSettingsPath();
        await writeTextFile(sp, JSON.stringify(settings, null, 2));
    }

    // ─── Default config (bundled resource) ───────────────────────────────────

    async function readDefaultConfig() {
        try {
            const resDir = await resourceDir();
            const configPath = joinPath(resDir, 'config.example.json');
            const data = await readTextFile(configPath);
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to read bundled config.example.json:', error);
            return { mcpServers: {} };
        }
    }

    // ─── Pure business logic (copied from routes.js) ──────────────────────────

    function filterDisabledServers(config) {
        const internalKeys = ['disabled', 'custom', '_removedFromDefaults'];
        const filteredConfig = { mcpServers: {} };

        Object.entries(config.mcpServers).forEach(([name, server]) => {
            if (!server.disabled) {
                const serverConfig = { ...server };
                internalKeys.forEach(key => delete serverConfig[key]);
                filteredConfig.mcpServers[name] = serverConfig;
            } else {
                console.log(`Filtering out disabled server: ${name}`);
            }
        });

        console.log('Filtered servers:', Object.keys(filteredConfig.mcpServers));
        return filteredConfig;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    // Mirrors GET /api/cursor-config
    async function getMergedConfig() {
        console.log('getMergedConfig()');
        const { CURSOR_CONFIG_PATH, CLAUDE_CONFIG_PATH } = await getConfigPaths();
        const settings = await readSettings();
        const cursorEnabled = settings.cursorIntegration?.enabled ?? true;

        let savedConfig = { mcpServers: {} };
        if (cursorEnabled) {
            savedConfig = await readConfigFile(CURSOR_CONFIG_PATH);
        }

        const claudeConfig = await readConfigFile(CLAUDE_CONFIG_PATH);
        const defaultConfig = await readDefaultConfig();

        const removedDefaults = savedConfig._removedDefaults || [];
        const mergedServers = {};

        // 1. Add default servers (excluding removed ones)
        Object.entries(defaultConfig.mcpServers || {}).forEach(([name, config]) => {
            if (!removedDefaults.includes(name)) {
                mergedServers[name] = { ...config };
            }
        });

        // 2. Override with Cursor saved config (if enabled) and mark custom servers
        if (cursorEnabled) {
            Object.entries(savedConfig.mcpServers || {}).forEach(([name, config]) => {
                mergedServers[name] = { ...mergedServers[name], ...config };
                if (!defaultConfig.mcpServers?.[name]) {
                    mergedServers[name].custom = true;
                }
            });
        }

        // 3. Add Claude Desktop servers not already present
        Object.entries(claudeConfig.mcpServers || {}).forEach(([name, config]) => {
            if (!mergedServers[name]) {
                mergedServers[name] = { ...config };
                if (!defaultConfig.mcpServers?.[name]) {
                    mergedServers[name].custom = true;
                }
            }
        });

        // 4. Sync disabled state with Claude Desktop — servers absent there are disabled
        const claudeServerNames = Object.keys(claudeConfig.mcpServers || {});
        Object.entries(mergedServers).forEach(([name]) => {
            if (!claudeServerNames.includes(name)) {
                mergedServers[name].disabled = true;
            }
        });

        console.log('Returning merged config with servers:', Object.keys(mergedServers));
        return { mcpServers: mergedServers, removedDefaults };
    }

    // Mirrors GET /api/tools
    async function getTools() {
        console.log('getTools()');
        const { CURSOR_CONFIG_PATH, CLAUDE_CONFIG_PATH } = await getConfigPaths();
        const settings = await readSettings();
        const cursorEnabled = settings.cursorIntegration?.enabled ?? true;

        const defaultConfig = await readDefaultConfig();
        const mergedServers = {};

        Object.entries(defaultConfig.mcpServers || {}).forEach(([name, config]) => {
            mergedServers[name] = { ...config };
        });

        if (cursorEnabled) {
            const cursorConfig = await readConfigFile(CURSOR_CONFIG_PATH);
            Object.entries(cursorConfig.mcpServers || {}).forEach(([name, config]) => {
                mergedServers[name] = { ...mergedServers[name], ...config };
            });
        }

        const claudeConfig = await readConfigFile(CLAUDE_CONFIG_PATH);
        Object.entries(claudeConfig.mcpServers || {}).forEach(([name, config]) => {
            if (!mergedServers[name]) {
                mergedServers[name] = { ...config };
            }
        });

        const toolsMap = {
            'mcp-manager': [{
                name: 'launch_manager',
                description: 'Launch the MCP Server Manager interface',
                inputSchema: { type: 'object', properties: {}, required: [] }
            }]
        };

        const enabledTools = Object.entries(toolsMap)
            .filter(([serverName]) => mergedServers[serverName] && !mergedServers[serverName].disabled)
            .flatMap(([serverName, tools]) =>
                tools.map(tool => ({ ...tool, server: serverName }))
            );

        console.log(`Returning ${enabledTools.length} tools`);
        return enabledTools;
    }

    // Mirrors POST /api/save-configs
    async function saveConfigs(mcpServers, removedServers) {
        console.log('saveConfigs()');
        const { CURSOR_CONFIG_PATH, CLAUDE_CONFIG_PATH } = await getConfigPaths();
        const settings = await readSettings();
        const cursorEnabled = settings.cursorIntegration?.enabled ?? true;

        const defaultConfig = await readDefaultConfig();
        const defaultServerNames = Object.keys(defaultConfig.mcpServers || {});

        // Track which default servers have been removed
        const removedDefaults = [];
        if (removedServers) {
            Object.keys(removedServers).forEach(name => {
                if (defaultServerNames.includes(name)) {
                    removedDefaults.push(name);
                }
            });
        }

        const fullConfig = { mcpServers };
        if (removedDefaults.length > 0) {
            fullConfig._removedDefaults = removedDefaults;
        }

        // Save full config to Cursor (UI state persistence) if integration enabled
        if (cursorEnabled) {
            try {
                await writeTextFile(CURSOR_CONFIG_PATH, JSON.stringify(fullConfig, null, 2));
                console.log('Saved config to Cursor settings');
            } catch (error) {
                console.warn('Failed to save Cursor config:', error);
            }
        } else {
            console.log('Cursor integration disabled, skipping Cursor config write');
        }

        // Save filtered config to Claude Desktop (disabled servers stripped)
        const filteredConfig = filterDisabledServers(fullConfig);
        const existingClaudeConfig = await readConfigFile(CLAUDE_CONFIG_PATH);
        const mergedClaudeConfig = {
            ...existingClaudeConfig,
            mcpServers: filteredConfig.mcpServers
        };
        console.log('Filtered config for Claude:', JSON.stringify(mergedClaudeConfig, null, 2));

        try {
            await writeTextFile(CLAUDE_CONFIG_PATH, JSON.stringify(mergedClaudeConfig, null, 2));
            console.log('Saved config to Claude settings');
        } catch (error) {
            console.warn('Failed to save Claude config:', error);
        }

        return {
            success: true,
            message: 'Configurations saved successfully. Please restart Claude to apply changes.'
        };
    }

    // Call once at app startup — validates Tauri environment and pre-warms paths
    async function init() {
        requireTauri();
        await getConfigPaths();
        console.log('Backend initialised. Config paths:', _configPaths);
    }

    return {
        init,
        getMergedConfig,
        getTools,
        saveConfigs,
        readSettings,
        writeSettings,
        readDefaultConfig
    };
})();
window.Backend = Backend;
