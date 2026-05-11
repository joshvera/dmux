import { afterEach, describe, expect, it, vi } from 'vitest';
import { PopupManager, type PopupManagerConfig } from '../src/services/PopupManager.js';
import { TmuxService } from '../src/services/TmuxService.js';

function createPopupManager(): PopupManager {
  const settingsManager = {
    getSettings: () => ({}),
    getGlobalSettings: () => ({}),
    getProjectSettings: () => ({}),
  };
  const config: PopupManagerConfig = {
    sidebarWidth: 40,
    projectRoot: '/tmp/project',
    popupsSupported: true,
    isDevMode: false,
    terminalWidth: 120,
    terminalHeight: 40,
    availableAgents: ['claude', 'codex'],
    settingsManager,
    getSettingsManagerForProjectRoot: () => settingsManager,
    projectSettings: {},
    trackProjectActivity: async (work) => await work(),
  };

  return new PopupManager(config, () => {}, () => {});
}

describe('PopupManager launchBlankProjectActionsPopup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the choice popup with project-action copy and client-fit sizing', async () => {
    const manager = createPopupManager() as any;

    manager.checkPopupSupport = vi.fn(() => true);
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: 'new-agent',
    });
    vi.spyOn(TmuxService, 'getInstance').mockReturnValue({
      getAllDimensions: vi.fn().mockResolvedValue({
        clientWidth: 50,
        clientHeight: 14,
      }),
    } as unknown as TmuxService);

    await manager.launchBlankProjectActionsPopup('services', '/repo');

    expect(manager.launchPopup).toHaveBeenCalledWith(
      'choicePopup.js',
      [],
      expect.objectContaining({
        title: 'Project Actions',
        positioning: 'centered',
        width: 46,
        height: 12,
      }),
      {
        title: 'Project Actions',
        message: 'No dmux panes yet in services. Choose an action.',
        options: [
          {
            id: 'new-agent',
            label: 'New agent',
            description: 'Create a new worktree pane',
            default: true,
          },
          {
            id: 'terminal',
            label: 'New terminal',
            description: 'Open a shell pane in this project',
          },
          {
            id: 'reopen',
            label: 'Reopen worktree',
            description: 'Resume a closed branch in this project',
          },
        ],
      },
      '/repo'
    );
  });
});
