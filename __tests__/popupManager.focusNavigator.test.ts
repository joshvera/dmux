import { describe, expect, it, vi } from 'vitest';
import { PopupManager, type PopupManagerConfig } from '../src/services/PopupManager.js';

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
});
