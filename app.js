let mcpServers = {};
let originalConfig = {};
let toolsList = [];
let defaultServers = {}; // Servers from config.example.json
let customServers = {};  // User-added servers
let removedServers = {}; // Removed custom servers
let appSettings = { cursorIntegration: { enabled: true } }; // App settings

// HTML escaping utilities to prevent XSS
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// API endpoints
const API = {
    CURSOR_CONFIG: '/api/cursor-config',
    CLAUDE_CONFIG: '/api/claude-config',
    TOOLS: '/api/tools',
    SAVE_CONFIGS: '/api/save-configs',
    SETTINGS: '/api/settings'
};

function showMessage(message, isError = true) {
    const messageDiv = document.getElementById(isError ? 'errorMessage' : 'successMessage');
    const otherDiv = document.getElementById(isError ? 'successMessage' : 'errorMessage');
    
    messageDiv.textContent = message;
    messageDiv.style.display = 'block';
    otherDiv.style.display = 'none';
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 10000); // Show for 10 seconds
}

async function fetchWithTimeout(url, options = {}) {
    const timeout = options.timeout || 5000;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    console.log('Fetching:', url, options);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        
        console.log('Response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Response data:', data);
        return data;
    } catch (error) {
        clearTimeout(id);
        console.error('Fetch error:', error);
        throw error;
    }
}

async function loadConfigs() {
    console.log('Loading configurations...');
    try {
        // Load settings first
        await loadSettings();

        // Load default servers from config.json
        console.log('Fetching default config...');
        const defaultConfig = await fetchWithTimeout('/config.json');
        defaultServers = defaultConfig.mcpServers || {};
        console.log('Default servers:', Object.keys(defaultServers));

        // Load cursor config first
        console.log('Fetching cursor config from:', API.CURSOR_CONFIG);
        const cursorConfig = await fetchWithTimeout(API.CURSOR_CONFIG);
        console.log('Received cursor config:', cursorConfig);
        
        if (!cursorConfig.mcpServers) {
            throw new Error('Invalid config format: missing mcpServers');
        }
        
        mcpServers = cursorConfig.mcpServers;
        
        // Get removed defaults from server
        const removedDefaults = cursorConfig.removedDefaults || [];
        
        // Separate default and custom servers
        customServers = {};
        removedServers = {};
        
        // Populate removedServers with removed default servers
        removedDefaults.forEach(name => {
            if (defaultServers[name]) {
                removedServers[name] = { ...defaultServers[name], _removedFromDefaults: true };
            }
        });
        
        Object.entries(mcpServers).forEach(([name, config]) => {
            if (config.custom) {
                customServers[name] = config;
            }
        });
        
        originalConfig = JSON.parse(JSON.stringify(mcpServers));
        
        console.log('Loaded servers:', Object.keys(mcpServers));
        console.log('Custom servers:', Object.keys(customServers));
        console.log('Removed defaults:', removedDefaults);
        
        // Render initial view
        renderServers();
        renderRemovedServers();

        // Load tools in background
        try {
            console.log('Fetching tools from:', API.TOOLS);
            toolsList = await fetchWithTimeout(API.TOOLS);
            console.log('Loaded tools:', toolsList);
            renderTools();
        } catch (error) {
            console.error('Error loading tools:', error);
            showMessage('Failed to load tools. Server list may be incomplete.');
        }
    } catch (error) {
        console.error('Error loading configs:', error);
        showMessage('Failed to load server configurations. Please refresh the page.');
    }
}

async function loadSettings() {
    console.log('Loading settings...');
    try {
        const settings = await fetchWithTimeout(API.SETTINGS);
        appSettings = settings;
        renderSettingsUI();
        return settings;
    } catch (error) {
        console.error('Error loading settings:', error);
        appSettings = { cursorIntegration: { enabled: true } };
        renderSettingsUI();
        return appSettings;
    }
}

async function saveSetting(settingPath, value) {
    console.log('Saving setting:', settingPath, value);
    try {
        // Update local state
        const keys = settingPath.split('.');
        let obj = appSettings;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) obj[keys[i]] = {};
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;

        // Save to backend
        await fetchWithTimeout(API.SETTINGS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appSettings)
        });

        return true;
    } catch (error) {
        console.error('Error saving setting:', error);
        showMessage('Failed to save setting: ' + error.message);
        return false;
    }
}

function renderSettingsUI() {
    const checkbox = document.getElementById('cursorIntegrationToggle');
    if (checkbox) {
        checkbox.checked = appSettings.cursorIntegration?.enabled ?? true;
    }
}

async function toggleCursorIntegration(enabled) {
    console.log('Toggling Cursor integration:', enabled);

    if (!enabled) {
        const confirmed = confirm(
            'Disabling Cursor integration will:\n\n' +
            '• Stop reading from Cursor\'s MCP configuration\n' +
            '• Stop writing to Cursor\'s MCP configuration\n' +
            '• Use Claude Desktop config as the source of truth\n\n' +
            'Are you sure you want to continue?'
        );

        if (!confirmed) {
            renderSettingsUI(); // Revert checkbox
            return;
        }
    }

    const success = await saveSetting('cursorIntegration.enabled', enabled);

    if (success) {
        showMessage(
            enabled
                ? 'Cursor integration enabled. Reload the page to see changes.'
                : 'Cursor integration disabled. Reload the page to see changes.',
            false
        );
    }
}

function toggleSettingsSection() {
    const content = document.getElementById('settingsContent');
    const icon = document.getElementById('settingsToggleIcon');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.textContent = '▲';
    } else {
        content.style.display = 'none';
        icon.textContent = '▼';
    }
}

function showView(view, clickedTab) {
    console.log('Switching view to:', view);
    // Update tabs
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    clickedTab.classList.add('active');

    // Update views
    document.getElementById('serversView').style.display = view === 'servers' ? 'grid' : 'none';
    document.getElementById('toolsView').style.display = view === 'tools' ? 'block' : 'none';

    // Refresh tools view when switching to it
    if (view === 'tools') {
        renderTools();
    }
}

function renderServers() {
    console.log('Rendering servers view with servers:', Object.keys(mcpServers));
    const grid = document.getElementById('serversView');
    grid.innerHTML = '';

    // Sort servers alphabetically
    const sortedServers = Object.entries(mcpServers).sort(([a], [b]) => a.localeCompare(b));

    sortedServers.forEach(([name, config]) => {
        console.log('Rendering server:', name, config);
        const card = document.createElement('div');
        card.className = 'server-card';
        
        const serverPath = Array.isArray(config.args) ? config.args[0] : '';
        const envVars = config.env || {};
        const isCustom = config.custom === true;
        const safeName = escapeAttr(name);
        const displayName = escapeHtml(name);

        card.innerHTML = `
            <div class="server-header">
                <span class="server-name">
                    ${displayName}
                    ${isCustom ? '<span class="server-badge">Custom</span>' : ''}
                </span>
                <label class="toggle-switch">
                    <input type="checkbox" ${config.disabled ? '' : 'checked'} 
                           onchange="toggleServer('${safeName}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="server-details">
                <div class="server-path">${escapeHtml(serverPath)}</div>
                ${Object.keys(envVars).length > 0 ? '<div class="env-vars">' + 
                    Object.entries(envVars).map(([key]) => 
                        `<div class="env-var">
                            <span>${escapeHtml(key)}</span>
                            <span>********</span>
                        </div>`
                    ).join('') + '</div>' : ''}
            </div>
            <div class="server-actions">
                <button class="edit-button" onclick="showEditServerModal('${safeName}')">Edit</button>
                <button class="remove-button" onclick="removeServer('${safeName}')">Remove</button>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

function renderTools() {
    console.log('Rendering tools view');
    const toolsView = document.getElementById('toolsView');
    toolsView.innerHTML = '';

    if (!toolsList || toolsList.length === 0) {
        toolsView.innerHTML = '<div class="no-tools">No tools available or still loading...</div>';
        return;
    }

    // Group tools by server
    const toolsByServer = toolsList.reduce((acc, tool) => {
        if (!acc[tool.server]) {
            acc[tool.server] = [];
        }
        acc[tool.server].push(tool);
        return acc;
    }, {});

    // Create server sections
    Object.entries(toolsByServer).forEach(([server, tools]) => {
        const serverSection = document.createElement('div');
        serverSection.className = 'server-tools';
        
        const content = `
            <h2>${server}</h2>
            <div class="tools-grid">
                ${tools.map(tool => `
                    <div class="tool-card">
                        <div class="tool-name">${tool.name}</div>
                        <div class="tool-description">${tool.description || 'No description available'}</div>
                        <div class="tool-schema">
                            ${JSON.stringify(tool.inputSchema || {}, null, 2)}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        serverSection.innerHTML = content;
        toolsView.appendChild(serverSection);
    });
}

function toggleServer(name, enabled) {
    console.log('Toggling server:', name, enabled);
    if (mcpServers[name]) {
        mcpServers[name].disabled = !enabled;
    }
}

async function saveChanges() {
    console.log('Saving changes...');
    try {
        // Filter out removed servers from mcpServers
        const serversToSave = {};
        Object.entries(mcpServers).forEach(([name, config]) => {
            if (!removedServers[name]) {
                serversToSave[name] = config;
            }
        });

        const result = await fetchWithTimeout(API.SAVE_CONFIGS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                mcpServers: serversToSave,
                removedServers: removedServers
            })
        });

        originalConfig = JSON.parse(JSON.stringify(serversToSave));
        showMessage(result.message || 'Configurations saved successfully. Please restart Claude to apply changes.', false);
        
        // Refresh tools list to reflect enabled/disabled servers
        const updatedTools = await fetchWithTimeout(API.TOOLS);
        toolsList = updatedTools;
        if (document.getElementById('toolsView').style.display !== 'none') {
            renderTools();
        }
    } catch (error) {
        console.error('Error saving configs:', error);
        showMessage('Error saving configurations: ' + error.message);
    }
}

// Initialize the app
console.log('Initializing MCP Manager...');
window.onload = loadConfigs;

// Export functions for global access
window.showView = showView;
window.toggleServer = toggleServer;
window.saveChanges = saveChanges;

// Modal functions
function showAddServerModal() {
    document.getElementById('modalTitle').textContent = 'Add Server';
    document.getElementById('editingServerName').value = '';
    document.getElementById('serverName').value = '';
    document.getElementById('serverCommand').value = '';
    document.getElementById('serverArgs').value = '';
    document.getElementById('envVarsContainer').innerHTML = '';
    document.getElementById('serverName').disabled = false;
    document.getElementById('serverModal').style.display = 'flex';
}

function showEditServerModal(name) {
    const server = mcpServers[name];
    if (!server) return;
    
    document.getElementById('modalTitle').textContent = 'Edit Server';
    document.getElementById('editingServerName').value = name;
    document.getElementById('serverName').value = name;
    document.getElementById('serverName').disabled = true;
    document.getElementById('serverCommand').value = server.command || '';
    document.getElementById('serverArgs').value = Array.isArray(server.args) ? server.args.join('\n') : '';
    
    // Populate environment variables
    const envVarsContainer = document.getElementById('envVarsContainer');
    envVarsContainer.innerHTML = '';
    if (server.env) {
        Object.entries(server.env).forEach(([key, value]) => {
            addEnvVarField(key, value);
        });
    }
    
    document.getElementById('serverModal').style.display = 'flex';
}

function hideAddServerModal() {
    document.getElementById('serverModal').style.display = 'none';
}

function addEnvVarField(key = '', value = '') {
    const container = document.getElementById('envVarsContainer');
    const row = document.createElement('div');
    row.className = 'env-var-row';
    row.innerHTML = `
        <input type="text" placeholder="KEY" value="${escapeAttr(key)}" class="env-key">
        <input type="text" placeholder="VALUE" value="${escapeAttr(value)}" class="env-value">
        <button type="button" class="remove-env-button" onclick="this.parentElement.remove()">Remove</button>
    `;
    container.appendChild(row);
}

function saveServer(event) {
    event.preventDefault();
    
    const editingName = document.getElementById('editingServerName').value;
    const name = document.getElementById('serverName').value.trim();
    const command = document.getElementById('serverCommand').value.trim();
    const argsText = document.getElementById('serverArgs').value;
    
    // Validation
    if (!name) {
        showMessage('Server name is required');
        return;
    }
    const validName = /^[a-zA-Z0-9_-]+$/;
    if (!validName.test(name)) {
        showMessage('Server name can only contain letters, numbers, hyphens, and underscores');
        return;
    }
    if (!command) {
        showMessage('Command is required');
        return;
    }
    
    // Check for duplicate names when adding new server
    if (!editingName && mcpServers[name]) {
        showMessage('A server with this name already exists');
        return;
    }
    
    // Parse arguments
    const args = argsText.split('\n').map(arg => arg.trim()).filter(arg => arg);
    
    // Parse environment variables
    const env = {};
    document.querySelectorAll('.env-var-row').forEach(row => {
        const key = row.querySelector('.env-key').value.trim();
        const value = row.querySelector('.env-value').value;
        if (key) {
            env[key] = value;
        }
    });
    
    // Create server config — only mark as custom for new servers or already-custom ones
    const isCustom = !editingName || !!(customServers[editingName]);
    const serverConfig = {
        command,
        args,
        env: Object.keys(env).length > 0 ? env : undefined,
        custom: isCustom ? true : undefined
    };
    
    // Remove undefined values
    Object.keys(serverConfig).forEach(key => {
        if (serverConfig[key] === undefined) {
            delete serverConfig[key];
        }
    });
    
    // Update servers
    if (editingName && editingName !== name) {
        // Rename server
        delete mcpServers[editingName];
        delete customServers[editingName];
    }
    
    mcpServers[name] = serverConfig;
    if (isCustom) {
        customServers[name] = serverConfig;
    }
    
    // Remove from removed servers if it was there
    if (removedServers[name]) {
        delete removedServers[name];
        renderRemovedServers();
    }
    
    renderServers();
    hideAddServerModal();
    showMessage('Server saved successfully', false);
}

function removeServer(name) {
    if (!confirm(`Are you sure you want to remove "${name}"?`)) {
        return;
    }
    
    // Move to removed servers
    removedServers[name] = mcpServers[name];
    
    // Remove from active servers
    delete mcpServers[name];
    delete customServers[name];
    
    // Also remove from defaultServers tracking if it was there
    // so it doesn't get re-added on reload
    if (defaultServers[name]) {
        // Mark as removed from defaults
        removedServers[name] = { ...removedServers[name], _removedFromDefaults: true };
    }
    
    renderServers();
    renderRemovedServers();
    showMessage('Server removed. You can restore it from the Removed Servers section.', false);
}

function restoreServer(name) {
    // Move back to active servers
    const config = removedServers[name];
    mcpServers[name] = config;
    
    // Only add to customServers if it was a custom server
    if (config.custom) {
        customServers[name] = config;
    }
    
    // Remove the _removedFromDefaults flag if present
    if (mcpServers[name]._removedFromDefaults) {
        delete mcpServers[name]._removedFromDefaults;
    }
    
    // Remove from removed servers
    delete removedServers[name];
    
    renderServers();
    renderRemovedServers();
    showMessage('Server restored successfully', false);
}

function toggleRemovedSection() {
    const content = document.getElementById('removedServersContent');
    const icon = document.getElementById('removedToggleIcon');
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.textContent = '▲';
    } else {
        content.style.display = 'none';
        icon.textContent = '▼';
    }
}

function renderRemovedServers() {
    const section = document.getElementById('removedServersSection');
    const list = document.getElementById('removedServersList');
    const removedCount = Object.keys(removedServers).length;
    
    if (removedCount === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    list.innerHTML = '';
    
    Object.entries(removedServers).forEach(([name, config]) => {
        const card = document.createElement('div');
        card.className = 'removed-server-card';
        
        card.innerHTML = `
            <div class="server-name">${escapeHtml(name)}</div>
            <div class="server-actions">
                <button class="restore-button" onclick="restoreServer('${escapeAttr(name)}')">Restore</button>
            </div>
        `;
        
        list.appendChild(card);
    });
}

// Note: renderServers is defined once above with edit/remove buttons and XSS escaping

// Export new functions for global access
window.showAddServerModal = showAddServerModal;
window.showEditServerModal = showEditServerModal;
window.hideAddServerModal = hideAddServerModal;
window.addEnvVarField = addEnvVarField;
window.saveServer = saveServer;
window.removeServer = removeServer;
window.restoreServer = restoreServer;
window.toggleRemovedSection = toggleRemovedSection;
window.loadSettings = loadSettings;
window.toggleCursorIntegration = toggleCursorIntegration;
window.toggleSettingsSection = toggleSettingsSection;
