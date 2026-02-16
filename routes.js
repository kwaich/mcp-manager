import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get config file paths based on OS
function getConfigPaths() {
    const home = process.env.HOME || process.env.USERPROFILE;
    const isMac = process.platform === 'darwin';
    
    if (isMac) {
        return {
            CURSOR_CONFIG_PATH: path.join(home, 'Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            CLAUDE_CONFIG_PATH: path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json')
        };
    } else if (process.platform === 'win32') {
        return {
            CURSOR_CONFIG_PATH: path.join(home, 'AppData/Roaming/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            CLAUDE_CONFIG_PATH: path.join(home, 'AppData/Roaming/Claude/claude_desktop_config.json')
        };
    } else {
        // Linux paths
        return {
            CURSOR_CONFIG_PATH: path.join(home, '.config/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            CLAUDE_CONFIG_PATH: path.join(home, '.config/Claude/claude_desktop_config.json')
        };
    }
}

const { CURSOR_CONFIG_PATH, CLAUDE_CONFIG_PATH } = getConfigPaths();

// Helper functions for settings file
async function readSettings() {
    try {
        const settingsPath = path.join(__dirname, 'settings.json');
        const data = await fs.readFile(settingsPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { cursorIntegration: { enabled: true } }; // Defaults
        }
        throw error;
    }
}

async function writeSettings(settings) {
    const settingsPath = path.join(__dirname, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

// Helper function to read config files
async function readConfigFile(filePath) {
    try {
        console.log('Reading config file:', filePath);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('No existing config found, using empty config');
            return { mcpServers: {} };
        }
        console.error(`Error reading ${filePath}:`, error);
        throw error;
    }
}

// Helper function to filter out disabled servers and internal metadata
function filterDisabledServers(config) {
    // Internal metadata keys that should not be written to external config files
    const internalKeys = ['disabled', 'custom', '_removedFromDefaults'];
    const filteredConfig = { mcpServers: {} };
    
    Object.entries(config.mcpServers).forEach(([name, server]) => {
        // Only include servers that are not disabled
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

// Get cursor config
router.get('/cursor-config', async (req, res) => {
    console.log('Handling /api/cursor-config request');
    // Merge precedence (highest to lowest):
    // 1. Cursor saved config — user's explicit settings, wins for overlapping servers
    // 2. Claude Desktop config — pulled in if server not already present
    // 3. Default config (config.json) — base defaults, excluded if in removedDefaults
    try {
        const settings = await readSettings();
        const cursorEnabled = settings.cursorIntegration?.enabled ?? true;

        let savedConfig = { mcpServers: {} };

        // Only read Cursor config if integration is enabled
        if (cursorEnabled) {
            savedConfig = await readConfigFile(CURSOR_CONFIG_PATH);
        }

        const claudeConfig = await readConfigFile(CLAUDE_CONFIG_PATH);
        const defaultConfig = await readConfigFile(path.join(__dirname, 'config.json'));
        
        // Get list of removed default servers
        const removedDefaults = savedConfig._removedDefaults || [];
        
        // Merge default servers with saved servers
        const mergedServers = {};
        
        // Add default servers (excluding removed ones)
        Object.entries(defaultConfig.mcpServers || {}).forEach(([name, config]) => {
            if (!removedDefaults.includes(name)) {
                mergedServers[name] = { ...config };
            }
        });
        
        // Override with saved Cursor configurations and add custom servers (if enabled)
        if (cursorEnabled) {
            Object.entries(savedConfig.mcpServers || {}).forEach(([name, config]) => {
                mergedServers[name] = {
                    ...mergedServers[name],
                    ...config
                };
                // Mark custom servers (servers not in defaults)
                if (!defaultConfig.mcpServers?.[name]) {
                    mergedServers[name].custom = true;
                }
            });
        }
        
        // Also add servers from Claude Desktop config if not already present
        Object.entries(claudeConfig.mcpServers || {}).forEach(([name, config]) => {
            if (!mergedServers[name]) {
                mergedServers[name] = { ...config };
                // Mark as custom if not in defaults
                if (!defaultConfig.mcpServers?.[name]) {
                    mergedServers[name].custom = true;
                }
            }
        });

        // Sync disabled state with Claude Desktop config
        // If a server is not in Claude Desktop's config, mark it as disabled
        const claudeServerNames = Object.keys(claudeConfig.mcpServers || {});
        Object.entries(mergedServers).forEach(([name, config]) => {
            if (!claudeServerNames.includes(name)) {
                mergedServers[name].disabled = true;
            }
        });

        console.log('Returning merged config with servers:', Object.keys(mergedServers));
        res.json({ 
            mcpServers: mergedServers,
            removedDefaults: removedDefaults
        });
    } catch (error) {
        console.error('Error in /api/cursor-config:', error);
        res.status(500).json({ error: `Failed to read Cursor config: ${error.message}` });
    }
});

// Get claude config
router.get('/claude-config', async (req, res) => {
    console.log('Handling /api/claude-config request');
    try {
        const config = await readConfigFile(CLAUDE_CONFIG_PATH);
        res.json(config);
    } catch (error) {
        console.error('Error in /api/claude-config:', error);
        res.status(500).json({ error: `Failed to read Claude config: ${error.message}` });
    }
});

// Get tools list
router.get('/tools', async (req, res) => {
    console.log('Handling /api/tools request');
    try {
        const settings = await readSettings();
        const cursorEnabled = settings.cursorIntegration?.enabled ?? true;

        const defaultConfig = await readConfigFile(path.join(__dirname, 'config.json'));

        // Simple two-way merge: defaults + Cursor overrides (if enabled)
        const mergedServers = {};
        Object.entries(defaultConfig.mcpServers || {}).forEach(([name, config]) => {
            mergedServers[name] = { ...config };
        });

        // Only merge Cursor config if integration is enabled
        if (cursorEnabled) {
            const cursorConfig = await readConfigFile(CURSOR_CONFIG_PATH);
            Object.entries(cursorConfig.mcpServers || {}).forEach(([name, config]) => {
                mergedServers[name] = { ...mergedServers[name], ...config };
            });
        }

        // Also include servers from Claude Desktop config if not already present
        const claudeConfig = await readConfigFile(CLAUDE_CONFIG_PATH);
        Object.entries(claudeConfig.mcpServers || {}).forEach(([name, config]) => {
            if (!mergedServers[name]) {
                mergedServers[name] = { ...config };
            }
        });

        const servers = mergedServers;

        // Define available tools for each server
        const toolsMap = {
            'mcp-manager': [{
                name: 'launch_manager',
                description: 'Launch the MCP Server Manager interface',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }]
        };

        // Filter tools based on enabled servers
        const enabledTools = Object.entries(toolsMap)
            .filter(([serverName]) => {
                return servers[serverName] && !servers[serverName].disabled;
            })
            .flatMap(([serverName, tools]) => 
                tools.map(tool => ({
                    ...tool,
                    server: serverName
                }))
            );

        console.log(`Returning ${enabledTools.length} tools`);
        res.json(enabledTools);
    } catch (error) {
        console.error('Error in /api/tools:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save configs
router.post('/save-configs', async (req, res) => {
    console.log('Handling /api/save-configs request');
    try {
        const { mcpServers, removedServers } = req.body;
        if (!mcpServers) {
            throw new Error('No server configuration provided');
        }

        const settings = await readSettings();
        const cursorEnabled = settings.cursorIntegration?.enabled ?? true;

        // Load default config to identify removed defaults
        const defaultConfig = await readConfigFile(path.join(__dirname, 'config.json'));
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

        // Create full config
        const fullConfig = { 
            mcpServers: mcpServers
        };
        
        // Add removed defaults tracking if any exist
        if (removedDefaults.length > 0) {
            fullConfig._removedDefaults = removedDefaults;
        }

        // Save full config to Cursor settings (for UI state persistence) if integration is enabled
        if (cursorEnabled) {
            try {
                await fs.writeFile(CURSOR_CONFIG_PATH, JSON.stringify(fullConfig, null, 2));
                console.log('Saved config to Cursor settings');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log('Cursor config path does not exist, skipping:', CURSOR_CONFIG_PATH);
                } else {
                    console.warn('Failed to save Cursor config:', error.message);
                }
            }
        } else {
            console.log('Cursor integration disabled, skipping Cursor config write');
        }

        // Save filtered config to Claude settings (removing disabled servers and internal metadata)
        const filteredConfig = filterDisabledServers(fullConfig);
        // Read existing Claude Desktop config to preserve non-mcpServers fields
        const existingClaudeConfig = await readConfigFile(CLAUDE_CONFIG_PATH);
        const mergedClaudeConfig = { ...existingClaudeConfig, mcpServers: filteredConfig.mcpServers };
        console.log('Filtered config for Claude:', JSON.stringify(mergedClaudeConfig, null, 2));
        try {
            await fs.writeFile(CLAUDE_CONFIG_PATH, JSON.stringify(mergedClaudeConfig, null, 2));
            console.log('Saved config to Claude settings');
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('Claude config path does not exist, skipping:', CLAUDE_CONFIG_PATH);
            } else {
                console.warn('Failed to save Claude config:', error.message);
            }
        }

        console.log('Configurations saved successfully');
        res.json({ 
            success: true, 
            message: 'Configurations saved successfully. Please restart Claude to apply changes.' 
        });
    } catch (error) {
        console.error('Error in /api/save-configs:', error);
        res.status(500).json({ error: `Failed to save configurations: ${error.message}` });
    }
});

// Get settings
router.get('/settings', async (req, res) => {
    console.log('Handling /api/settings request');
    try {
        const settings = await readSettings();
        res.json(settings);
    } catch (error) {
        console.error('Error in /api/settings:', error);
        res.status(500).json({ error: `Failed to read settings: ${error.message}` });
    }
});

// Save settings
router.post('/settings', async (req, res) => {
    console.log('Handling /api/settings POST request');
    try {
        await writeSettings(req.body);
        console.log('Settings saved successfully');
        res.json({ success: true });
    } catch (error) {
        console.error('Error in /api/settings POST:', error);
        res.status(500).json({ error: `Failed to save settings: ${error.message}` });
    }
});

export default router;
