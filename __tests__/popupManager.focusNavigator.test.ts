import { afterEach, describe, expect, it, vi } from 'vitest';
import { PopupManager, type PopupManagerConfig } from '../src/services/PopupManager.js';
import { TmuxService } from '../src/services/TmuxService.js';

function createPopupManager(): PopupManager {
  const config: PopupManagerConfig = {
    sidebarWidth: 40,
    projectRoot: '/tmp/project',
    popupsSupported: true,
    isDevMode: false,
    terminalWidth: 120,
    terminalHeight: 40,
    availableAgents: ['claude', 'codex'],
    settingsManager: {
      getSettings: () => ({}),
      getGlobalSettings: () => ({}),
      getProjectSettings: () => ({}),
    },
    projectSettings: {},
    trackProjectActivity: async (work) => await work(),
  };

  return new PopupManager(config, () => {}, () => {});
}

describe('PopupManager launchFocusNavigatorPopup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('launches the fullscreen navigator with focus positioning', async () => {
    const manager = createPopupManager() as any;

    manager.checkPopupSupport = vi.fn(() => true);
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: { kind: 'focus', action: 'exit' },
    });

    await manager.launchFocusNavigatorPopup({
      panes: [],
      sidebarProjects: [],
      projectRoot: '/tmp/project',
      projectName: 'project',
      selectedPaneId: 'pane-1',
    });

    expect(manager.launchPopup).toHaveBeenCalledWith(
      'focusNavigatorPopup.js',
      [],
      expect.objectContaining({
        title: 'Focus Navigator',
        positioning: 'focus',
      }),
      {
        panes: [],
        sidebarProjects: [],
        projectRoot: '/tmp/project',
        projectName: 'project',
        selectedPaneId: 'pane-1',
      },
      undefined
    );
  });

  it('clamps focus navigator size to narrow active clients', async () => {
    const manager = createPopupManager() as any;

    manager.checkPopupSupport = vi.fn(() => true);
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: { kind: 'focus', action: 'exit' },
    });
    vi.spyOn(TmuxService, 'getInstance').mockReturnValue({
      getAllDimensions: vi.fn().mockResolvedValue({
        clientWidth: 50,
        clientHeight: 14,
      }),
    } as unknown as TmuxService);

    await manager.launchFocusNavigatorPopup({
      panes: [],
      sidebarProjects: [],
      projectRoot: '/tmp/project',
      projectName: 'project',
    });

    const [, , popupOptions] = manager.launchPopup.mock.calls[0];
    expect(popupOptions.width).toBe(46);
    expect(popupOptions.height).toBe(12);
  });

  it('falls back to terminal dimensions when client lookup fails', async () => {
    const config: PopupManagerConfig = {
      sidebarWidth: 40,
      projectRoot: '/tmp/project',
      popupsSupported: true,
      isDevMode: false,
      terminalWidth: 48,
      terminalHeight: 13,
      availableAgents: ['claude', 'codex'],
      settingsManager: {
        getSettings: () => ({}),
        getGlobalSettings: () => ({}),
        getProjectSettings: () => ({}),
      },
      projectSettings: {},
      trackProjectActivity: async (work) => await work(),
    };
    const manager = new PopupManager(config, () => {}, () => {}) as any;

    manager.checkPopupSupport = vi.fn(() => true);
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: { kind: 'focus', action: 'exit' },
    });
    vi.spyOn(TmuxService, 'getInstance').mockReturnValue({
      getAllDimensions: vi.fn().mockRejectedValue(new Error('tmux unavailable')),
    } as unknown as TmuxService);

    await manager.launchFocusNavigatorPopup({
      panes: [],
      sidebarProjects: [],
      projectRoot: '/tmp/project',
      projectName: 'project',
    });

    const [, , popupOptions] = manager.launchPopup.mock.calls[0];
    expect(popupOptions.width).toBe(44);
    expect(popupOptions.height).toBe(11);
  });
});
