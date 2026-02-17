let mcpServers = {};
let originalConfig = {};
let toolsList = [];
let defaultServers = {};
let customServers = {};
let removedServers = {};
let appSettings = { cursorIntegration: { enabled: true } };
let currentView = 'servers';

// ─── HTML Escaping (XSS prevention) ───────────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// ─── Toast System ──────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div class="toast-dot"></div><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    const dismiss = () => {
        toast.classList.add('exiting');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    const timer = setTimeout(dismiss, 4000);
    toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

// Keep backward-compat alias
function showMessage(message, isError = true) {
    showToast(message, isError ? 'error' : 'success');
}

// ─── Loading Skeleton ──────────────────────────────────────────────────────────
function showLoadingSkeletons() {
    const grid = document.getElementById('serverGrid');
    grid.innerHTML = '';
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-grid';
    skeleton.id = 'skeletonGrid';
    for (let i = 0; i < 4; i++) {
        const card = document.createElement('div');
        card.className = 'skeleton-card';
        skeleton.appendChild(card);
    }
    grid.appendChild(skeleton);
}

function removeLoadingSkeletons() {
    const s = document.getElementById('skeletonGrid');
    if (s) s.remove();
}

// ─── Config Loading ────────────────────────────────────────────────────────────
async function loadConfigs() {
    console.log('Loading configurations...');
    showLoadingSkeletons();

    try {
        await Backend.init();
        await loadSettings();

        console.log('Reading default config...');
        const defaultConfig = await Backend.readDefaultConfig();
        defaultServers = defaultConfig.mcpServers || {};

        console.log('Getting merged config...');
        const cursorConfig = await Backend.getMergedConfig();
        if (!cursorConfig.mcpServers) throw new Error('Invalid config format: missing mcpServers');

        mcpServers = cursorConfig.mcpServers;
        const removedDefaults = cursorConfig.removedDefaults || [];

        customServers = {};
        removedServers = {};

        removedDefaults.forEach(name => {
            if (defaultServers[name]) {
                removedServers[name] = { ...defaultServers[name], _removedFromDefaults: true };
            }
        });

        Object.entries(mcpServers).forEach(([name, config]) => {
            if (config.custom) customServers[name] = config;
        });

        originalConfig = JSON.parse(JSON.stringify(mcpServers));

        removeLoadingSkeletons();
        renderServers();
        renderRemovedServers();

        try {
            toolsList = await Backend.getTools();
            renderTools();
        } catch (err) {
            console.error('Error loading tools:', err);
            showToast('Failed to load tools — server list may be incomplete.', 'error');
        }
    } catch (error) {
        console.error('Error loading configs:', error);
        removeLoadingSkeletons();
        showToast('Failed to load server configurations. Please restart the app.', 'error');
    }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
    try {
        const settings = await Backend.readSettings();
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
    try {
        const keys = settingPath.split('.');
        let obj = appSettings;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) obj[keys[i]] = {};
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
        await Backend.writeSettings(appSettings);
        return true;
    } catch (error) {
        console.error('Error saving setting:', error);
        showToast('Failed to save setting: ' + (error?.message ?? String(error)), 'error');
        return false;
    }
}

function renderSettingsUI() {
    const checkbox = document.getElementById('cursorIntegrationToggle');
    if (checkbox) checkbox.checked = appSettings.cursorIntegration?.enabled ?? true;
}

// ─── Cursor Integration Toggle ─────────────────────────────────────────────────
async function applyCursorToggle(enabled) {
    const success = await saveSetting('cursorIntegration.enabled', enabled);
    if (success) {
        await loadConfigs();
        showToast(
            enabled ? 'Cursor integration enabled.' : 'Cursor integration disabled.',
            'success'
        );
    }
}

async function toggleCursorIntegration(enabled) {
    if (!enabled) {
        showConfirmModal(
            'Disabling Cursor integration will:\n\n' +
            '• Stop reading from Cursor\'s MCP configuration\n' +
            '• Stop writing to Cursor\'s MCP configuration\n' +
            '• Use Claude Desktop config as the source of truth\n\n' +
            'Are you sure you want to continue?',
            async () => { await applyCursorToggle(false); },
            () => { renderSettingsUI(); }
        );
        return;
    }
    await applyCursorToggle(true);
}

// ─── Confirm Modal ─────────────────────────────────────────────────────────────
function showConfirmModal(message, onConfirm, onCancel) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmMessage').textContent = message;
    modal.style.display = 'flex';

    document.getElementById('confirmOk').onclick = () => {
        modal.style.display = 'none';
        onConfirm();
    };
    document.getElementById('confirmCancel').onclick = () => {
        modal.style.display = 'none';
        if (onCancel) onCancel();
    };
}

// ─── View Navigation ───────────────────────────────────────────────────────────
function showView(view) {
    currentView = view;

    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });

    // Show/hide views
    const views = { serversView: 'servers', toolsView: 'tools', settingsView: 'settings' };
    Object.entries(views).forEach(([id, name]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = name === view ? 'block' : 'none';
        if (name === view) {
            // Re-trigger animation
            el.classList.remove('view');
            void el.offsetWidth; // reflow
            el.classList.add('view');
        }
    });

    // Show toolbar only on servers view
    const toolbar = document.getElementById('toolbar');
    if (toolbar) toolbar.style.display = view === 'servers' ? 'flex' : 'none';

    if (view === 'tools') renderTools();
}

// ─── Render Servers ────────────────────────────────────────────────────────────
function renderServers() {
    const grid = document.getElementById('serverGrid');
    grid.innerHTML = '';

    const sortedServers = Object.entries(mcpServers).sort(([a], [b]) => a.localeCompare(b));

    sortedServers.forEach(([name, config], index) => {
        const isCustom = config.custom === true;
        const isDisabled = !!config.disabled;
        const safeName = escapeAttr(name);
        const displayName = escapeHtml(name);
        const envVars = config.env || {};
        const envCount = Object.keys(envVars).length;

        // Build command display
        const cmdParts = [config.command];
        if (Array.isArray(config.args) && config.args.length) {
            cmdParts.push(...config.args.slice(0, 2));
            if (config.args.length > 2) cmdParts.push('…');
        }
        const cmdDisplay = escapeHtml(cmdParts.join(' '));

        const card = document.createElement('div');
        card.className = `server-card${isDisabled ? ' is-disabled' : ''}`;
        card.style.animationDelay = `${index * 40}ms`;

        card.innerHTML = `
            <div class="card-header">
                <div class="card-title-row">
                    <span class="server-name">${displayName}</span>
                    ${isCustom ? '<span class="server-badge">Custom</span>' : ''}
                </div>
                <div class="card-actions">
                    <button class="btn-icon edit" title="Edit" onclick="showEditServerModal('${safeName}')">
                        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" width="13" height="13">
                            <path d="M10 2l2 2L4.5 11.5H2.5v-2L10 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="btn-icon remove" title="Remove" onclick="removeServer('${safeName}')">
                        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" width="13" height="13">
                            <path d="M2 4h10M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3 4l.75 7.5h6.5L11 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <label class="toggle-switch" title="${isDisabled ? 'Enable' : 'Disable'} server">
                        <input type="checkbox" ${isDisabled ? '' : 'checked'}
                               onchange="toggleServer('${safeName}', this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="server-command">
                <span class="cmd-label">cmd</span>
                ${cmdDisplay}
            </div>
            ${envCount > 0 ? `
            <div class="env-badge">
                <div class="env-badge-dot"></div>
                ${envCount} env var${envCount !== 1 ? 's' : ''}
            </div>` : ''}
        `;

        grid.appendChild(card);
    });
}

// ─── Render Tools ──────────────────────────────────────────────────────────────
function renderTools() {
    const toolsView = document.getElementById('toolsView');
    if (!toolsView) return;
    toolsView.innerHTML = '';

    if (!toolsList || toolsList.length === 0) {
        toolsView.innerHTML = '<div class="no-tools">No tools available. Enable some servers and save changes first.</div>';
        return;
    }

    const toolsByServer = toolsList.reduce((acc, tool) => {
        if (!acc[tool.server]) acc[tool.server] = [];
        acc[tool.server].push(tool);
        return acc;
    }, {});

    Object.entries(toolsByServer).forEach(([server, tools], sectionIndex) => {
        const section = document.createElement('div');
        section.className = 'tools-server-section expanded';
        section.style.animationDelay = `${sectionIndex * 60}ms`;

        const toolsHtml = tools.map(tool => {
            const schemaStr = JSON.stringify(tool.inputSchema || {}, null, 2);
            return `
                <div class="tool-card">
                    <div class="tool-name">${escapeHtml(tool.name)}</div>
                    <div class="tool-description">${escapeHtml(tool.description || 'No description available')}</div>
                    <button class="tool-schema-toggle" onclick="toggleToolSchema(this)">Show Schema</button>
                    <pre class="tool-schema">${escapeHtml(schemaStr)}</pre>
                </div>
            `;
        }).join('');

        section.innerHTML = `
            <div class="tools-server-header" onclick="toggleToolsSection(this.parentElement)">
                <span class="tools-server-name">${escapeHtml(server)}</span>
                <svg class="tools-chevron" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <div class="tools-grid">${toolsHtml}</div>
        `;

        toolsView.appendChild(section);
    });
}

function toggleToolsSection(section) {
    section.classList.toggle('expanded');
}

function toggleToolSchema(btn) {
    const schema = btn.nextElementSibling;
    schema.classList.toggle('visible');
    btn.textContent = schema.classList.contains('visible') ? 'Hide Schema' : 'Show Schema';
}

// ─── Render Removed Servers ────────────────────────────────────────────────────
function renderRemovedServers() {
    const section = document.getElementById('removedServersSection');
    const list = document.getElementById('removedServersList');
    const count = Object.keys(removedServers).length;

    if (count === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    list.innerHTML = '';

    Object.entries(removedServers).forEach(([name]) => {
        const row = document.createElement('div');
        row.className = 'removed-server-row';
        row.innerHTML = `
            <span class="removed-server-name">${escapeHtml(name)}</span>
            <button class="btn-restore" onclick="restoreServer('${escapeAttr(name)}')">Restore</button>
        `;
        list.appendChild(row);
    });
}

// ─── Server Toggle ─────────────────────────────────────────────────────────────
function toggleServer(name, enabled) {
    if (mcpServers[name]) {
        mcpServers[name].disabled = !enabled;
        // Update card disabled state without full re-render
        const cards = document.querySelectorAll('.server-card');
        cards.forEach(card => {
            const nameEl = card.querySelector('.server-name');
            if (nameEl && nameEl.textContent.trim() === name) {
                card.classList.toggle('is-disabled', !enabled);
            }
        });
    }
}

// ─── Save Changes ──────────────────────────────────────────────────────────────
async function saveChanges() {
    try {
        const serversToSave = {};
        Object.entries(mcpServers).forEach(([name, config]) => {
            if (!removedServers[name]) serversToSave[name] = config;
        });

        const result = await Backend.saveConfigs(serversToSave, removedServers);
        originalConfig = JSON.parse(JSON.stringify(serversToSave));
        showToast(result.message || 'Saved. Restart Claude to apply changes.', 'success');

        const updatedTools = await Backend.getTools();
        toolsList = updatedTools;
        if (currentView === 'tools') renderTools();
    } catch (error) {
        console.error('Error saving configs:', error);
        showToast('Error saving configurations: ' + error.message, 'error');
    }
}

// ─── Search Filter ─────────────────────────────────────────────────────────────
function filterServers(query) {
    const q = query.trim().toLowerCase();
    document.querySelectorAll('.server-card').forEach(card => {
        const name = card.querySelector('.server-name');
        if (!name) return;
        const matches = !q || name.textContent.toLowerCase().includes(q);
        card.classList.toggle('is-hidden', !matches);
    });
}

// ─── Add Server Modal ──────────────────────────────────────────────────────────
function showAddServerModal() {
    document.getElementById('modalTitle').textContent = 'Add Server';
    document.getElementById('editingServerName').value = '';
    document.getElementById('serverName').value = '';
    document.getElementById('serverName').disabled = false;
    document.getElementById('serverCommand').value = '';
    document.getElementById('serverArgs').value = '';
    document.getElementById('envVarsContainer').innerHTML = '';
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

    const envVarsContainer = document.getElementById('envVarsContainer');
    envVarsContainer.innerHTML = '';
    if (server.env) {
        Object.entries(server.env).forEach(([key, value]) => addEnvVarField(key, value));
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
        <button type="button" class="btn-remove-env" onclick="this.parentElement.remove()" title="Remove">×</button>
    `;
    container.appendChild(row);
}

function saveServer(event) {
    event.preventDefault();

    const editingName = document.getElementById('editingServerName').value;
    const name = document.getElementById('serverName').value.trim();
    const command = document.getElementById('serverCommand').value.trim();
    const argsText = document.getElementById('serverArgs').value;

    if (!name) { showToast('Server name is required', 'error'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        showToast('Name can only contain letters, numbers, hyphens, and underscores', 'error');
        return;
    }
    if (!command) { showToast('Command is required', 'error'); return; }
    if (!editingName && mcpServers[name]) {
        showToast('A server with this name already exists', 'error');
        return;
    }

    const args = argsText.split('\n').map(a => a.trim()).filter(Boolean);

    const env = {};
    document.querySelectorAll('.env-var-row').forEach(row => {
        const key = row.querySelector('.env-key').value.trim();
        const value = row.querySelector('.env-value').value;
        if (key) env[key] = value;
    });

    const isCustom = !editingName || !!(customServers[editingName]);
    const serverConfig = { command, args };
    if (Object.keys(env).length > 0) serverConfig.env = env;
    if (isCustom) serverConfig.custom = true;

    if (editingName && editingName !== name) {
        delete mcpServers[editingName];
        delete customServers[editingName];
    }

    mcpServers[name] = serverConfig;
    if (isCustom) customServers[name] = serverConfig;

    if (removedServers[name]) {
        delete removedServers[name];
        renderRemovedServers();
    }

    renderServers();
    hideAddServerModal();
    showToast('Server saved successfully', 'success');
}

// ─── Remove / Restore Server ───────────────────────────────────────────────────
function removeServer(name) {
    showConfirmModal(
        `Remove "${name}"?\n\nYou can restore it from the Removed Servers section below.`,
        () => {
            removedServers[name] = mcpServers[name];
            delete mcpServers[name];
            delete customServers[name];
            if (defaultServers[name]) {
                removedServers[name] = { ...removedServers[name], _removedFromDefaults: true };
            }
            renderServers();
            renderRemovedServers();
            showToast('Server removed.', 'info');
        }
    );
}

function restoreServer(name) {
    const config = removedServers[name];
    mcpServers[name] = config;
    if (config.custom) customServers[name] = config;
    if (mcpServers[name]._removedFromDefaults) delete mcpServers[name]._removedFromDefaults;
    delete removedServers[name];
    renderServers();
    renderRemovedServers();
    showToast('Server restored.', 'success');
}

// ─── Init ──────────────────────────────────────────────────────────────────────
window.onload = loadConfigs;

// ─── Global exports ─────────────────────────────────────────────────────────────
window.showView = showView;
window.toggleServer = toggleServer;
window.saveChanges = saveChanges;
window.filterServers = filterServers;
window.showAddServerModal = showAddServerModal;
window.showEditServerModal = showEditServerModal;
window.hideAddServerModal = hideAddServerModal;
window.addEnvVarField = addEnvVarField;
window.saveServer = saveServer;
window.removeServer = removeServer;
window.restoreServer = restoreServer;
window.loadSettings = loadSettings;
window.toggleCursorIntegration = toggleCursorIntegration;
window.toggleToolsSection = toggleToolsSection;
window.toggleToolSchema = toggleToolSchema;
