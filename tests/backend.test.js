import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { describe, it, expect } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKEND_CODE = readFileSync(join(__dirname, '../dist/backend.js'), 'utf8')

// ─── Path constants (derived from mock path helpers) ─────────────────────────
const SETTINGS_PATH = '/app-data/settings.json'
const LOCAL_CONFIG_PATH = '/app-data/config.json'
const RESOURCE_CONFIG_PATH = '/resources/config.example.json'
const CLAUDE_PATH =
  '/home/test/Library/Application Support/Claude/claude_desktop_config.json'
const CURSOR_PATH =
  '/home/test/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'

// ─── Fixture data ─────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  mcpServers: {
    'example-server': {
      command: 'node',
      args: ['/path/to/server.js'],
      env: { API_KEY: 'your-api-key-here' }
    },
    airtable: {
      command: 'node',
      args: ['/path/to/airtable-mcp/build/index.js'],
      env: { AIRTABLE_API_KEY: 'your-airtable-api-key' }
    },
    'brave-search': {
      command: 'node',
      args: ['/path/to/brave-search/dist/index.js'],
      env: { BRAVE_API_KEY: 'your-brave-api-key' }
    },
    github: {
      command: 'node',
      args: ['/path/to/github/dist/index.js'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'your-github-token' }
    },
    'google-maps': {
      command: 'node',
      args: ['/path/to/google-maps/dist/index.js'],
      env: { GOOGLE_MAPS_API_KEY: 'your-google-maps-api-key' }
    },
    filesystem: {
      command: 'node',
      args: ['/path/to/filesystem/dist/index.js', '/path/to/allowed/directory']
    },
    perplexity: {
      command: 'node',
      args: ['/path/to/perplexity/dist/index.js'],
      env: { PERPLEXITY_API_KEY: 'your-perplexity-api-key' }
    }
  }
}

const SETTINGS_CURSOR_ENABLED = { cursorIntegration: { enabled: true } }
const SETTINGS_CURSOR_DISABLED = { cursorIntegration: { enabled: false } }
const LOCAL_CONFIG_EMPTY = {
  version: 1,
  disabledServers: [],
  serverDefinitions: {},
  deletedServers: {},
  removedDefaults: []
}

// ─── Core helper ──────────────────────────────────────────────────────────────

/**
 * Instantiate a fresh Backend IIFE with an in-memory filesystem.
 * Returns { backend, fs } — `fs` is shared so tests can inspect written files.
 */
function createBackend({ files = {}, platform = 'MacIntel' } = {}) {
  const fs = { ...files }

  const mockWindow = {
    __TAURI__: {
      core: {
        invoke: async (command, argsOrData, options) => {
          if (command === 'plugin:fs|read_text_file') {
            const { path } = argsOrData
            if (fs[path] === undefined) throw new Error('os error 2')
            return new TextEncoder().encode(fs[path]).buffer
          }
          if (command === 'plugin:fs|write_text_file') {
            const path = decodeURIComponent(options.headers.path)
            fs[path] = new TextDecoder().decode(argsOrData)
          }
          // mkdir — no-op; directory always "exists" in in-memory fs
        }
      },
      path: {
        homeDir: async () => '/home/test',
        appDataDir: async () => '/app-data',
        resourceDir: async () => '/resources'
      }
    }
  }

  // Execute the IIFE in a fresh scope, injecting the mock globals.
  // The IIFE ends with `window.Backend = Backend`, so mockWindow.Backend is set.
  const factory = new Function('window', 'navigator', 'document', BACKEND_CODE)
  factory(mockWindow, { platform }, { body: { innerHTML: '' } })

  return { backend: mockWindow.Backend, fs }
}

/** Convenience — pretty-print to match backend's JSON.stringify(_, null, 2) */
function j(obj) {
  return JSON.stringify(obj, null, 2)
}

/**
 * Standard baseline files shared across getMergedConfig, saveConfigs, and getTools tests.
 * Includes an empty CLAUDE_PATH so saveConfigs tests can read it without failing.
 * getMergedConfig and getTools tests are unaffected by an empty Claude config.
 */
function baseFiles(overrides = {}) {
  return {
    [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG),
    [SETTINGS_PATH]: j(SETTINGS_CURSOR_ENABLED),
    [LOCAL_CONFIG_PATH]: j(LOCAL_CONFIG_EMPTY),
    [CLAUDE_PATH]: j({ mcpServers: {} }),
    ...overrides
  }
}

// ─── readSettings() ───────────────────────────────────────────────────────────

describe('readSettings()', () => {
  it('returns default { cursorIntegration: { enabled: true } } when settings.json is absent', async () => {
    const { backend } = createBackend({ files: {} })
    const result = await backend.readSettings()
    expect(result).toEqual({ cursorIntegration: { enabled: true } })
  })

  it('returns parsed settings when file exists with valid JSON', async () => {
    const { backend } = createBackend({
      files: { [SETTINGS_PATH]: j({ cursorIntegration: { enabled: false } }) }
    })
    const result = await backend.readSettings()
    expect(result).toEqual({ cursorIntegration: { enabled: false } })
  })

  it('returns default when file contains invalid JSON', async () => {
    const { backend } = createBackend({
      files: { [SETTINGS_PATH]: 'not valid json {{{' }
    })
    const result = await backend.readSettings()
    expect(result).toEqual({ cursorIntegration: { enabled: true } })
  })
})

// ─── writeSettings() ──────────────────────────────────────────────────────────

describe('writeSettings()', () => {
  it('writes pretty-printed JSON to settings.json path', async () => {
    const { backend, fs } = createBackend()
    const settings = { cursorIntegration: { enabled: false } }
    await backend.writeSettings(settings)
    expect(fs[SETTINGS_PATH]).toBe(j(settings))
  })

  it('written file is valid JSON that round-trips correctly', async () => {
    const { backend, fs } = createBackend()
    const settings = { cursorIntegration: { enabled: true }, extra: 'data' }
    await backend.writeSettings(settings)
    expect(JSON.parse(fs[SETTINGS_PATH])).toEqual(settings)
    expect(fs[SETTINGS_PATH]).toMatch(/\n  /)
  })
})

// ─── readDefaultConfig() ──────────────────────────────────────────────────────

describe('readDefaultConfig()', () => {
  it('returns parsed config.example.json from resourceDir()', async () => {
    const { backend } = createBackend({
      files: { [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG) }
    })
    const result = await backend.readDefaultConfig()
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('returns { mcpServers: {} } when resource file is missing', async () => {
    const { backend } = createBackend({ files: {} })
    const result = await backend.readDefaultConfig()
    expect(result).toEqual({ mcpServers: {} })
  })
})

// ─── getMergedConfig() — 4-way merge ─────────────────────────────────────────

describe('getMergedConfig() — 4-way merge', () => {
  it('returns all 7 default servers when only defaults exist', async () => {
    const { backend } = createBackend({ files: baseFiles() })
    const result = await backend.getMergedConfig()
    const names = Object.keys(result.mcpServers)

    expect(names).toHaveLength(7)
    expect(names).toContain('example-server')
    expect(names).toContain('airtable')
    expect(names).toContain('filesystem')

    // Plain defaults should have no internal flags
    expect(result.mcpServers['airtable'].custom).toBeUndefined()
    expect(result.mcpServers['airtable'].disabled).toBeUndefined()
    expect(result.mcpServers['airtable'].deleted).toBeUndefined()

    // Actual command/args should come from DEFAULT_CONFIG
    expect(result.mcpServers['airtable'].command).toBe('node')
    expect(result.mcpServers['airtable'].args[0]).toBe('/path/to/airtable-mcp/build/index.js')
  })

  it('Cursor config overrides default server values', async () => {
    const cursorConfig = {
      mcpServers: {
        airtable: {
          command: 'node',
          args: ['/custom/airtable/index.js'],
          env: { AIRTABLE_API_KEY: 'real-key-123' }
        }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({ [CURSOR_PATH]: j(cursorConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['airtable'].env.AIRTABLE_API_KEY).toBe('real-key-123')
    expect(result.mcpServers['airtable'].args[0]).toBe('/custom/airtable/index.js')
  })

  it('Cursor-only (non-default) server gets custom: true flag', async () => {
    const cursorConfig = {
      mcpServers: {
        'my-custom': { command: 'python', args: ['/home/user/my-server.py'] }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({ [CURSOR_PATH]: j(cursorConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['my-custom']).toBeDefined()
    expect(result.mcpServers['my-custom'].custom).toBe(true)
  })

  it('Claude-only server added with custom: true', async () => {
    const claudeConfig = {
      mcpServers: {
        'claude-only': { command: 'node', args: ['/claude/server.js'] }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({ [CLAUDE_PATH]: j(claudeConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['claude-only']).toBeDefined()
    expect(result.mcpServers['claude-only'].custom).toBe(true)
  })

  it('removedDefaults excludes listed servers from result', async () => {
    const localConfig = { ...LOCAL_CONFIG_EMPTY, removedDefaults: ['github'] }
    const { backend } = createBackend({
      files: baseFiles({ [LOCAL_CONFIG_PATH]: j(localConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['github']).toBeUndefined()
    expect(Object.keys(result.mcpServers)).toHaveLength(6)
    expect(Object.keys(result.mcpServers)).toContain('airtable')
    expect(Object.keys(result.mcpServers)).not.toContain('github')
  })

  it('disabled server is present with disabled: true', async () => {
    const localConfig = {
      ...LOCAL_CONFIG_EMPTY,
      disabledServers: ['airtable'],
      serverDefinitions: {
        airtable: {
          command: 'node',
          args: ['/path/to/airtable-mcp/build/index.js'],
          env: { AIRTABLE_API_KEY: 'my-key' }
        }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({ [LOCAL_CONFIG_PATH]: j(localConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['airtable']).toBeDefined()
    expect(result.mcpServers['airtable'].disabled).toBe(true)
  })

  it('disabled custom server is restored with disabled: true and custom: true', async () => {
    const localConfig = {
      ...LOCAL_CONFIG_EMPTY,
      disabledServers: ['my-custom'],
      serverDefinitions: {
        'my-custom': { command: 'python', args: ['/home/user/my-server.py'] }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({ [LOCAL_CONFIG_PATH]: j(localConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['my-custom']).toBeDefined()
    expect(result.mcpServers['my-custom'].disabled).toBe(true)
    expect(result.mcpServers['my-custom'].custom).toBe(true)
  })

  it('deleted server appears in result with deleted: true and custom: true', async () => {
    const localConfig = {
      ...LOCAL_CONFIG_EMPTY,
      deletedServers: {
        'old-server': { command: 'node', args: ['/old/server.js'] }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({ [LOCAL_CONFIG_PATH]: j(localConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['old-server']).toBeDefined()
    expect(result.mcpServers['old-server'].deleted).toBe(true)
    expect(result.mcpServers['old-server'].custom).toBe(true)
  })

  it('Cursor disabled: Cursor servers not included; defaults only', async () => {
    const cursorConfig = {
      mcpServers: {
        'cursor-only': { command: 'node', args: ['/cursor/server.js'] }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({
        [SETTINGS_PATH]: j(SETTINGS_CURSOR_DISABLED),
        [CURSOR_PATH]: j(cursorConfig)
      })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers['cursor-only']).toBeUndefined()
    expect(Object.keys(result.mcpServers)).toHaveLength(7)
  })

  it('returns removedDefaults array matching local config', async () => {
    const localConfig = { ...LOCAL_CONFIG_EMPTY, removedDefaults: ['github', 'airtable'] }
    const { backend } = createBackend({
      files: baseFiles({ [LOCAL_CONFIG_PATH]: j(localConfig) })
    })
    const result = await backend.getMergedConfig()
    expect(result.removedDefaults).toEqual(['github', 'airtable'])
  })

  it('Claude config missing mcpServers key contributes nothing to merge', async () => {
    const { backend } = createBackend({
      files: baseFiles({ [CLAUDE_PATH]: j({ tools: { someKey: true } }) })
    })
    const result = await backend.getMergedConfig()
    // Claude config has no mcpServers — all 7 defaults come from resource config
    expect(Object.keys(result.mcpServers)).toHaveLength(7)
    expect(result.mcpServers['airtable']).toBeDefined()
  })
})

// ─── saveConfigs() ────────────────────────────────────────────────────────────

describe('saveConfigs()', () => {
  it('writes only enabled servers to Claude config', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    const servers = {
      airtable: { command: 'node', args: ['/airtable/index.js'], env: { AIRTABLE_API_KEY: 'k' } },
      github: { command: 'node', args: ['/github/index.js'], disabled: true }
    }
    await backend.saveConfigs(servers, {})
    const written = JSON.parse(fs[CLAUDE_PATH])
    expect(written.mcpServers['airtable']).toBeDefined()
    expect(written.mcpServers['github']).toBeUndefined()
    expect(written.mcpServers['airtable'].args[0]).toBe('/airtable/index.js')
  })

  it('writes only enabled servers to Cursor config', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    const servers = {
      airtable: { command: 'node', args: ['/airtable/index.js'] },
      github: { command: 'node', args: ['/github/index.js'], disabled: true }
    }
    await backend.saveConfigs(servers, {})
    const written = JSON.parse(fs[CURSOR_PATH])
    expect(written.mcpServers['airtable']).toBeDefined()
    expect(written.mcpServers['github']).toBeUndefined()
  })

  it('strips internal metadata keys from Claude config', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    const servers = {
      'my-custom': {
        command: 'python',
        args: ['/my.py'],
        custom: true,
        _removedFromDefaults: false
      }
    }
    await backend.saveConfigs(servers, {})
    const written = JSON.parse(fs[CLAUDE_PATH]).mcpServers['my-custom']
    expect(written.disabled).toBeUndefined()
    expect(written.custom).toBeUndefined()
    expect(written.deleted).toBeUndefined()
    expect(written._removedFromDefaults).toBeUndefined()
    expect(written.command).toBe('python')
    expect(written.args[0]).toBe('/my.py')
  })

  it('preserves other top-level Claude config keys (e.g. tools)', async () => {
    const { backend, fs } = createBackend({
      files: baseFiles({
        [CLAUDE_PATH]: j({ mcpServers: {}, tools: { someKey: true } })
      })
    })
    await backend.saveConfigs({ airtable: { command: 'node', args: [] } }, {})
    const written = JSON.parse(fs[CLAUDE_PATH])
    expect(written.tools).toEqual({ someKey: true })
  })

  it('skips Cursor write when integration is disabled', async () => {
    const { backend, fs } = createBackend({
      files: baseFiles({ [SETTINGS_PATH]: j(SETTINGS_CURSOR_DISABLED) })
    })
    await backend.saveConfigs({ airtable: { command: 'node', args: [] } }, {})
    expect(fs[CURSOR_PATH]).toBeUndefined()
  })

  it('tracks disabled server in local config disabledServers list', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    await backend.saveConfigs(
      {
        github: {
          command: 'node',
          args: ['/github/index.js'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'token' },
          disabled: true
        }
      },
      {}
    )
    const localConfig = JSON.parse(fs[LOCAL_CONFIG_PATH])
    expect(localConfig.disabledServers).toContain('github')
  })

  it('stores full disabled server definition in serverDefinitions', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    await backend.saveConfigs(
      {
        github: {
          command: 'node',
          args: ['/github/index.js'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'token' },
          disabled: true
        }
      },
      {}
    )
    const localConfig = JSON.parse(fs[LOCAL_CONFIG_PATH])
    expect(localConfig.serverDefinitions['github']).toBeDefined()
    expect(localConfig.serverDefinitions['github'].command).toBe('node')
  })

  it('stores deleted custom server in deletedServers', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    await backend.saveConfigs(
      {
        'old-custom': {
          command: 'python',
          args: ['/old.py'],
          custom: true,
          deleted: true
        }
      },
      {}
    )
    const localConfig = JSON.parse(fs[LOCAL_CONFIG_PATH])
    expect(localConfig.deletedServers['old-custom']).toBeDefined()
  })

  it('tracks removed default server in removedDefaults', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    await backend.saveConfigs({}, { github: { command: 'node', args: [] } })
    const localConfig = JSON.parse(fs[LOCAL_CONFIG_PATH])
    expect(localConfig.removedDefaults).toContain('github')
  })

  it('does NOT put a removed default server in deletedServers', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    await backend.saveConfigs({}, { github: { command: 'node', args: [] } })
    const localConfig = JSON.parse(fs[LOCAL_CONFIG_PATH])
    expect(localConfig.deletedServers['github']).toBeUndefined()
  })

  it('removed default server is absent from both Cursor and Claude writes', async () => {
    const { backend, fs } = createBackend({ files: baseFiles() })
    await backend.saveConfigs({}, { github: { command: 'node', args: [] } })
    expect(JSON.parse(fs[CURSOR_PATH]).mcpServers['github']).toBeUndefined()
    expect(JSON.parse(fs[CLAUDE_PATH]).mcpServers['github']).toBeUndefined()
  })

  it('returns { success: true } on successful writes', async () => {
    const { backend } = createBackend({ files: baseFiles() })
    const result = await backend.saveConfigs(
      { airtable: { command: 'node', args: [] } },
      {}
    )
    expect(result.success).toBe(true)
  })

  it('returns { success: false } with message when Claude write fails', async () => {
    // Build a mock that throws specifically on the Claude config write path
    const fs = {
      [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG),
      [SETTINGS_PATH]: j(SETTINGS_CURSOR_ENABLED),
      [LOCAL_CONFIG_PATH]: j(LOCAL_CONFIG_EMPTY),
      [CLAUDE_PATH]: j({ mcpServers: {} })
    }
    const mockWindow = {
      __TAURI__: {
        core: {
          invoke: async (command, argsOrData, options) => {
            if (command === 'plugin:fs|read_text_file') {
              const { path } = argsOrData
              if (fs[path] === undefined) throw new Error('os error 2')
              return new TextEncoder().encode(fs[path]).buffer
            }
            if (command === 'plugin:fs|write_text_file') {
              const path = decodeURIComponent(options.headers.path)
              if (path === CLAUDE_PATH) throw new Error('Permission denied')
              fs[path] = new TextDecoder().decode(argsOrData)
            }
          }
        },
        path: {
          homeDir: async () => '/home/test',
          appDataDir: async () => '/app-data',
          resourceDir: async () => '/resources'
        }
      }
    }
    const factory = new Function('window', 'navigator', 'document', BACKEND_CODE)
    factory(mockWindow, { platform: 'MacIntel' }, { body: { innerHTML: '' } })

    const result = await mockWindow.Backend.saveConfigs(
      { airtable: { command: 'node', args: [] } },
      {}
    )
    expect(result.success).toBe(false)
    expect(result.message).toContain('Claude Desktop')
  })

  it('returns { success: false } with message when Cursor write fails', async () => {
    // Build a mock that throws specifically on the Cursor config write path
    const fs = {
      [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG),
      [SETTINGS_PATH]: j(SETTINGS_CURSOR_ENABLED),
      [LOCAL_CONFIG_PATH]: j(LOCAL_CONFIG_EMPTY),
      [CLAUDE_PATH]: j({ mcpServers: {} })
    }
    const mockWindow = {
      __TAURI__: {
        core: {
          invoke: async (command, argsOrData, options) => {
            if (command === 'plugin:fs|read_text_file') {
              const { path } = argsOrData
              if (fs[path] === undefined) throw new Error('os error 2')
              return new TextEncoder().encode(fs[path]).buffer
            }
            if (command === 'plugin:fs|write_text_file') {
              const path = decodeURIComponent(options.headers.path)
              if (path === CURSOR_PATH) throw new Error('Permission denied')
              fs[path] = new TextDecoder().decode(argsOrData)
            }
          }
        },
        path: {
          homeDir: async () => '/home/test',
          appDataDir: async () => '/app-data',
          resourceDir: async () => '/resources'
        }
      }
    }
    const factory = new Function('window', 'navigator', 'document', BACKEND_CODE)
    factory(mockWindow, { platform: 'MacIntel' }, { body: { innerHTML: '' } })

    const result = await mockWindow.Backend.saveConfigs(
      { airtable: { command: 'node', args: [] } },
      {}
    )
    expect(result.success).toBe(false)
    expect(result.message).toContain('Cursor')
  })

  it('handles null removedServers without crashing', async () => {
    const { backend } = createBackend({ files: baseFiles() })
    const result = await backend.saveConfigs(
      { airtable: { command: 'node', args: [] } },
      null
    )
    expect(result.success).toBe(true)
  })

  it('invalidates cache so getTools re-reads disk after saveConfigs', async () => {
    // Start with mcp-manager enabled in Claude config
    const files = {
      [RESOURCE_CONFIG_PATH]: j({ mcpServers: {} }),
      [SETTINGS_PATH]: j(SETTINGS_CURSOR_ENABLED),
      [LOCAL_CONFIG_PATH]: j(LOCAL_CONFIG_EMPTY),
      [CLAUDE_PATH]: j({
        mcpServers: { 'mcp-manager': { command: 'node', args: ['/manager.js'] } }
      })
    }
    const { backend } = createBackend({ files })

    // Warm the cache — mcp-manager is enabled
    await backend.getMergedConfig()
    let tools = await backend.getTools()
    expect(tools).toHaveLength(1)

    // Save with mcp-manager disabled — this nulls _lastMergedServers
    await backend.saveConfigs(
      { 'mcp-manager': { command: 'node', args: ['/manager.js'], disabled: true } },
      {}
    )

    // getTools must re-read (cache is gone) and discover mcp-manager is now disabled
    tools = await backend.getTools()
    expect(tools).toHaveLength(0)
  })
})

// ─── getTools() ───────────────────────────────────────────────────────────────

describe('getTools()', () => {
  it('returns empty array when mcp-manager server is absent', async () => {
    const { backend } = createBackend({ files: baseFiles() })
    const result = await backend.getTools()
    expect(result).toEqual([])
  })

  it('returns empty array when mcp-manager server is present but disabled', async () => {
    const localConfig = {
      ...LOCAL_CONFIG_EMPTY,
      disabledServers: ['mcp-manager'],
      serverDefinitions: {
        'mcp-manager': { command: 'node', args: ['/manager.js'] }
      }
    }
    const { backend } = createBackend({
      files: baseFiles({ [LOCAL_CONFIG_PATH]: j(localConfig) })
    })
    const result = await backend.getTools()
    expect(result).toEqual([])
  })

  it('returns launch_manager tool when mcp-manager is enabled', async () => {
    const claudeConfig = {
      mcpServers: { 'mcp-manager': { command: 'node', args: ['/manager.js'] } }
    }
    const { backend } = createBackend({
      files: baseFiles({ [CLAUDE_PATH]: j(claudeConfig) })
    })
    const result = await backend.getTools()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('launch_manager')
    expect(result[0].server).toBe('mcp-manager')
    expect(result[0].description).toBeDefined()
    expect(result[0].inputSchema).toBeDefined()
  })
})

// ─── init() — migrateRemovedDefaults() ────────────────────────────────────────

describe('init() — migrateRemovedDefaults()', () => {
  it('migrates _removedDefaults from Cursor config to local config, deduplicating', async () => {
    const { backend, fs } = createBackend({
      files: {
        [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG),
        [SETTINGS_PATH]: j(SETTINGS_CURSOR_ENABLED),
        [LOCAL_CONFIG_PATH]: j({ ...LOCAL_CONFIG_EMPTY, removedDefaults: ['airtable'] }),
        [CURSOR_PATH]: j({ _removedDefaults: ['github', 'github'], mcpServers: {} })
      }
    })
    await backend.init()

    const localConfig = JSON.parse(fs[LOCAL_CONFIG_PATH])
    expect(localConfig.removedDefaults).toContain('airtable')
    expect(localConfig.removedDefaults).toContain('github')
    // Deduplicated — 'github' appears exactly once
    expect(localConfig.removedDefaults.filter(x => x === 'github')).toHaveLength(1)

    // _removedDefaults removed from Cursor config
    const cursorConfig = JSON.parse(fs[CURSOR_PATH])
    expect(cursorConfig._removedDefaults).toBeUndefined()
  })
})

// ─── getConfigPaths() — Windows ───────────────────────────────────────────────

describe('getConfigPaths() — Windows', () => {
  it('uses AppData\\Roaming paths when platform is Win32', async () => {
    const { backend, fs } = createBackend({
      platform: 'Win32',
      files: {
        // Only the resource config is needed; all other reads fall back to defaults gracefully
        [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG)
      }
    })
    await backend.saveConfigs({ airtable: { command: 'node', args: [] } }, {})
    expect(Object.keys(fs).some(k => k.includes('AppData'))).toBe(true)
  })
})

// ─── getConfigPaths() — Linux ─────────────────────────────────────────────────

describe('getConfigPaths() — Linux', () => {
  it('uses ~/.config paths when platform is Linux', async () => {
    const { backend, fs } = createBackend({
      platform: 'Linux x86_64',
      files: {
        [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG)
      }
    })
    await backend.saveConfigs({ airtable: { command: 'node', args: [] } }, {})
    const writtenPaths = Object.keys(fs)
    expect(writtenPaths.some(k => k.includes('.config/Claude'))).toBe(true)
    expect(writtenPaths.some(k => k.includes('.config/Cursor'))).toBe(true)
    expect(writtenPaths.some(k => k.includes('AppData'))).toBe(false)
    expect(writtenPaths.some(k => k.includes('Library'))).toBe(false)
  })
})

// ─── readDefaultConfig() — edge cases ─────────────────────────────────────────

describe('readDefaultConfig() — edge cases', () => {
  it('returns { mcpServers: {} } when resource file contains invalid JSON', async () => {
    const { backend } = createBackend({
      files: { [RESOURCE_CONFIG_PATH]: 'not valid json {{{' }
    })
    const result = await backend.readDefaultConfig()
    expect(result).toEqual({ mcpServers: {} })
  })
})

// ─── readConfigFile() — error handling ────────────────────────────────────────

describe('readConfigFile() — error handling', () => {
  it('returns { mcpServers: {} } when file read throws permission error', async () => {
    const fs = {
      [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG),
      [SETTINGS_PATH]: j(SETTINGS_CURSOR_ENABLED),
      [LOCAL_CONFIG_PATH]: j(LOCAL_CONFIG_EMPTY)
    }
    const mockWindow = {
      __TAURI__: {
        core: {
          invoke: async (command, argsOrData) => {
            if (command === 'plugin:fs|read_text_file') {
              const { path } = argsOrData
              if (path === CLAUDE_PATH) throw new Error('Permission denied')
              if (fs[path] === undefined) throw new Error('os error 2')
              return new TextEncoder().encode(fs[path]).buffer
            }
          }
        },
        path: {
          homeDir: async () => '/home/test',
          appDataDir: async () => '/app-data',
          resourceDir: async () => '/resources'
        }
      }
    }
    const factory = new Function('window', 'navigator', 'document', BACKEND_CODE)
    factory(mockWindow, { platform: 'MacIntel' }, { body: { innerHTML: '' } })

    const result = await mockWindow.Backend.getMergedConfig()
    expect(result.mcpServers).toBeDefined()
    expect(Object.keys(result.mcpServers)).toHaveLength(7)
  })

  it('returns { mcpServers: {} } for empty file content', async () => {
    const fs = {
      [RESOURCE_CONFIG_PATH]: j(DEFAULT_CONFIG),
      [SETTINGS_PATH]: j(SETTINGS_CURSOR_ENABLED),
      [LOCAL_CONFIG_PATH]: j(LOCAL_CONFIG_EMPTY),
      [CLAUDE_PATH]: ''
    }
    const mockWindow = {
      __TAURI__: {
        core: {
          invoke: async (command, argsOrData) => {
            if (command === 'plugin:fs|read_text_file') {
              const { path } = argsOrData
              if (fs[path] === undefined) throw new Error('os error 2')
              return new TextEncoder().encode(fs[path]).buffer
            }
          }
        },
        path: {
          homeDir: async () => '/home/test',
          appDataDir: async () => '/app-data',
          resourceDir: async () => '/resources'
        }
      }
    }
    const factory = new Function('window', 'navigator', 'document', BACKEND_CODE)
    factory(mockWindow, { platform: 'MacIntel' }, { body: { innerHTML: '' } })

    const result = await mockWindow.Backend.getMergedConfig()
    expect(result.mcpServers).toBeDefined()
    expect(Object.keys(result.mcpServers)).toHaveLength(7)
  })
})

// ─── Empty state handling ─────────────────────────────────────────────────────

describe('Empty state handling', () => {
  it('handles null mcpServers in Claude config', async () => {
    const { backend } = createBackend({
      files: baseFiles({ [CLAUDE_PATH]: j({ mcpServers: null }) })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers).toBeDefined()
    expect(Object.keys(result.mcpServers)).toHaveLength(7)
  })

  it('handles missing mcpServers key in both configs', async () => {
    const { backend } = createBackend({
      files: baseFiles({
        [CLAUDE_PATH]: j({ tools: {} }),
        [CURSOR_PATH]: j({ tools: {} })
      })
    })
    const result = await backend.getMergedConfig()
    expect(result.mcpServers).toBeDefined()
    expect(Object.keys(result.mcpServers)).toHaveLength(7)
    expect(result.mcpServers['airtable']).toBeDefined()
  })
})
