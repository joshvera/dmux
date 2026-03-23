import { describe, expect, it, vi } from 'vitest';
import { PopupManager, type PopupManagerConfig } from '../src/services/PopupManager.js';
import { TmuxService } from '../src/services/TmuxService.js';
import { createCanonicalFocusModeFixture } from './fixtures/focusMode.js';

function createPopupManager(): PopupManager {
  const config: PopupManagerConfig = {
    sidebarWidth: 40,
    projectRoot: '/tmp/project',
    popupsSupported: true,
    isDevMode: true,
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

describe('PopupManager launchFocusActionSheetPopup', () => {
  it('uses pane menu actions as the source of truth while filtering primary and legacy actions', async () => {
    const manager = createPopupManager() as any;
    const fixture = createCanonicalFocusModeFixture({ includeRunningProcess: true });
    const pane = fixture.selectedPane;
    const getAllDimensions = vi.fn().mockResolvedValue({
      clientWidth: 80,
      clientHeight: 24,
    });

    manager.checkPopupSupport = vi.fn(() => true);
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: 'toggle_visibility',
    });
    vi.spyOn(TmuxService, 'getInstance').mockReturnValue({
      getAllDimensions,
    } as unknown as TmuxService);

    await manager.launchFocusActionSheetPopup(pane, fixture.panes);

    const [, popupArgs, popupOptions] = manager.launchPopup.mock.calls[0];
    const actions = JSON.parse(popupArgs[1]);
    const actionIds = actions.map((action: { id: string }) => action.id);

    expect(actionIds).not.toContain('view');
    expect(actionIds).not.toContain('close');
    expect(actionIds).not.toContain('merge');
    expect(actionIds).not.toContain('open_output');
    expect(actionIds).toContain('attach_agent');
    expect(actionIds).toContain('create_child_worktree');
    expect(actionIds).toContain('open_terminal_in_worktree');
    expect(actionIds).toContain('open_file_browser');
    expect(actionIds).toContain('toggle_visibility');
    expect(actionIds).toContain('hide-others');
    expect(actionIds).toContain('focus-project');
    expect(actionIds).toContain('set_source');

    expect(manager.launchPopup).toHaveBeenCalledWith(
      'focusActionSheetPopup.js',
      ['Alpha One', expect.any(String)],
      expect.objectContaining({
        width: 76,
        height: 20,
        title: 'Actions: Alpha One',
        positioning: 'focus',
      }),
      undefined,
      '/repo-a'
    );
    expect(popupOptions.width).toBeLessThanOrEqual(76);
    expect(popupOptions.height).toBeGreaterThanOrEqual(16);
    expect(getAllDimensions).toHaveBeenCalledOnce();
  });
});
