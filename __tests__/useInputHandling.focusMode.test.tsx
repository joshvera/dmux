import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useInputHandling } from '../src/hooks/useInputHandling.js';
import { TmuxService } from '../src/services/TmuxService.js';
import type { DmuxPane } from '../src/types.js';
import {
  createShellPane,
} from '../src/utils/shellPaneDetection.js';
import {
  drainRemotePaneActions,
  getCurrentTmuxSessionName,
} from '../src/utils/remotePaneActions.js';
import {
  getResumableBranches,
} from '../src/utils/resumeBranches.js';

vi.mock('../src/utils/tmux.js', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/tmux.js')>('../src/utils/tmux.js');
  return {
    ...actual,
    enforceControlPaneSize: vi.fn(async () => {}),
  };
});

vi.mock('../src/utils/shellPaneDetection.js', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/shellPaneDetection.js')>('../src/utils/shellPaneDetection.js');
  return {
    ...actual,
    createShellPane: vi.fn(async (paneId: string, nextId: number) => ({
      id: `dmux-${nextId}`,
      slug: `shell-${nextId}`,
      prompt: '',
      paneId,
      projectRoot: '/repo',
      projectName: 'repo',
      type: 'shell',
      shellType: 'zsh',
    })),
  };
});

vi.mock('../src/utils/remotePaneActions.js', () => ({
  drainRemotePaneActions: vi.fn(async () => []),
  getCurrentTmuxSessionName: vi.fn(() => null),
}));

vi.mock('../src/utils/resumeBranches.js', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/resumeBranches.js')>('../src/utils/resumeBranches.js');
  return {
    ...actual,
    getResumableBranches: vi.fn(() => []),
  };
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pane(id: string, options: Partial<DmuxPane> = {}): DmuxPane {
  return {
    id,
    slug: `pane-${id}`,
    prompt: `prompt-${id}`,
    paneId: `%${id}`,
    projectRoot: '/repo',
    worktreePath: `/repo/.dmux/worktrees/pane-${id}`,
    ...options,
  };
}

function Harness({
  panes,
  selectedIndex = 0,
  presentationMode,
  popupManager,
  settingsManager,
  controlPaneId = '%0',
  setSelectedIndex = vi.fn(),
  setStatusMessage = vi.fn(),
  savePanes = vi.fn(async () => {}),
  loadPanes = vi.fn(async () => {}),
  handlePaneCreationWithAgent = vi.fn(async () => []),
  handleCreateChildWorktree = vi.fn(async () => []),
  handleReopenWorktree = vi.fn(async () => null),
}: {
  panes: DmuxPane[];
  selectedIndex?: number;
  presentationMode: 'grid' | 'single-pane' | 'focus';
  popupManager: any;
  settingsManager: any;
  controlPaneId?: string;
  setSelectedIndex?: ReturnType<typeof vi.fn>;
  setStatusMessage?: ReturnType<typeof vi.fn>;
  savePanes?: ReturnType<typeof vi.fn>;
  loadPanes?: ReturnType<typeof vi.fn>;
  handlePaneCreationWithAgent?: ReturnType<typeof vi.fn>;
  handleCreateChildWorktree?: ReturnType<typeof vi.fn>;
  handleReopenWorktree?: ReturnType<typeof vi.fn>;
}) {
  useInputHandling({
    panes,
    selectedIndex,
    setSelectedIndex,
    isCreatingPane: false,
    setIsCreatingPane: vi.fn(),
    runningCommand: false,
    isUpdating: false,
    isLoading: false,
    ignoreInput: false,
    isDevMode: false,
    quitConfirmMode: false,
    setQuitConfirmMode: vi.fn(),
    showCommandPrompt: null,
    setShowCommandPrompt: vi.fn(),
    commandInput: '',
    setCommandInput: vi.fn(),
    showFileCopyPrompt: false,
    setShowFileCopyPrompt: vi.fn(),
    currentCommandType: null,
    setCurrentCommandType: vi.fn(),
    projectSettings: {},
    saveSettings: vi.fn(),
    settingsManager,
    popupManager,
    actionSystem: {
      actionState: {},
      executeAction: vi.fn(),
      executeCallback: vi.fn(),
      clearDialog: vi.fn(),
      clearStatus: vi.fn(),
      setActionState: vi.fn(),
    },
    controlPaneId,
    trackProjectActivity: vi.fn(async (work: () => unknown) => await work()),
    presentationMode,
    popupsSupported: true,
    setStatusMessage,
    copyNonGitFiles: vi.fn(),
    runCommandInternal: vi.fn(),
    handlePaneCreationWithAgent,
    handleCreateChildWorktree,
    handleReopenWorktree,
    setDevSourceFromPane: vi.fn(),
    savePanes,
    sidebarProjects: [{ projectRoot: '/repo', projectName: 'repo' }],
    saveSidebarProjects: vi.fn(async (projects) => projects),
    loadPanes,
    cleanExit: vi.fn(),
    availableAgents: ['claude'],
    panesFile: '/repo/.dmux/dmux.config.json',
    projectRoot: '/repo',
    projectActionItems: [],
    findCardInDirection: vi.fn(() => null),
  });

  return <Text>dmux</Text>;
}

describe('useInputHandling focus mode', () => {
  const tmuxServiceMock = {
    selectPane: vi.fn(async () => {}),
    setPaneZoom: vi.fn(async () => {}),
    isWindowZoomed: vi.fn(async () => false),
    joinPaneToTarget: vi.fn(async () => {}),
    breakPaneToWindow: vi.fn(async () => {}),
    splitPane: vi.fn(async () => '%2'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue(null);
    vi.mocked(drainRemotePaneActions).mockResolvedValue([]);
    vi.mocked(getResumableBranches).mockReturnValue([]);
    vi.spyOn(TmuxService, 'getInstance').mockReturnValue(
      tmuxServiceMock as unknown as TmuxService
    );
  });

  it('enters focus mode by explicitly zooming the selected pane', async () => {
    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        key: 'presentationMode',
        value: 'focus',
        scope: 'global',
      })),
    };
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => 'global'),
    };

    const { stdin, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={settingsManager}
      />
    );

    await sleep(20);
    stdin.write('s');
    await sleep(60);

    expect(settingsManager.updateSetting).toHaveBeenCalledWith(
      'presentationMode',
      'focus',
      'global'
    );
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%1', undefined);
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%1', true);

    unmount();
  });

  it('switches panes in focus mode while preserving zoom', async () => {
    tmuxServiceMock.isWindowZoomed.mockResolvedValue(true);

    const { stdin, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
      />
    );

    await sleep(40);
    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();

    stdin.write('j');
    await sleep(40);

    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%1', {
      preserveZoom: true,
    });
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%1', true);

    unmount();
  });

  it('exits focus mode by explicitly unzooming before restoring grid mode', async () => {
    tmuxServiceMock.isWindowZoomed.mockResolvedValue(true);
    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        key: 'presentationMode',
        value: 'grid',
        scope: 'global',
      })),
    };
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => 'global'),
    };

    const { stdin, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={settingsManager}
      />
    );

    await sleep(40);
    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();

    stdin.write('s');
    await sleep(60);

    expect(settingsManager.updateSetting).toHaveBeenCalledWith(
      'presentationMode',
      'grid',
      'global'
    );
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%1', false);
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%0');

    unmount();
  });

  it('reattaches hidden panes in focus mode and ends zoomed', async () => {
    tmuxServiceMock.isWindowZoomed.mockResolvedValue(false);
    const savePanes = vi.fn(async () => {});
    const loadPanes = vi.fn(async () => {});

    const { stdin, unmount } = render(
      <Harness
        panes={[pane('1', { hidden: true })]}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await sleep(40);
    tmuxServiceMock.joinPaneToTarget.mockClear();
    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    savePanes.mockClear();
    loadPanes.mockClear();

    stdin.write('j');
    await sleep(60);

    expect(tmuxServiceMock.joinPaneToTarget).toHaveBeenCalledWith(
      '%1',
      '%0',
      true,
      true
    );
    expect(savePanes).toHaveBeenCalled();
    expect(loadPanes).toHaveBeenCalled();
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%1', true);

    unmount();
  });

  it('falls back to another visible pane in focus mode instead of re-showing the hidden selection', async () => {
    const setSelectedIndex = vi.fn();
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => 'global'),
    };

    const { rerender, unmount } = render(
      <Harness
        panes={[pane('1'), pane('2')]}
        selectedIndex={0}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={settingsManager}
        setSelectedIndex={setSelectedIndex}
      />
    );

    await sleep(40);
    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    tmuxServiceMock.joinPaneToTarget.mockClear();
    setSelectedIndex.mockClear();

    rerender(
      <Harness
        panes={[pane('1', { hidden: true }), pane('2')]}
        selectedIndex={0}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={settingsManager}
        setSelectedIndex={setSelectedIndex}
      />
    );

    await sleep(60);

    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%2', undefined);
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%2', true);
    expect(
      tmuxServiceMock.joinPaneToTarget.mock.calls.some(
        ([sourcePaneId]) => sourcePaneId === '%1'
      )
    ).toBe(false);

    unmount();
  });

  it('reanchors focus on a visible fallback immediately after hiding the active pane', async () => {
    const setSelectedIndex = vi.fn();
    const savePanes = vi.fn(async () => {});
    const loadPanes = vi.fn(async () => {});
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => 'global'),
    };

    const { stdin, unmount } = render(
      <Harness
        panes={[pane('1'), pane('2')]}
        selectedIndex={1}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={settingsManager}
        setSelectedIndex={setSelectedIndex}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await sleep(40);
    tmuxServiceMock.breakPaneToWindow.mockClear();
    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    setSelectedIndex.mockClear();

    stdin.write('h');
    await sleep(80);

    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith('%2', 'dmux-hidden-2');
    expect(setSelectedIndex).toHaveBeenCalledWith(0);
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%1', undefined);
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%1', true);
    expect(savePanes).toHaveBeenCalledWith([
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ id: '2', hidden: true }),
    ]);
    expect(loadPanes).toHaveBeenCalled();

    unmount();
  });

  it('updates stale single-pane selection to another visible pane without re-showing the hidden one', async () => {
    const setSelectedIndex = vi.fn();
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => 'global'),
    };

    const { rerender, unmount } = render(
      <Harness
        panes={[pane('1'), pane('2')]}
        selectedIndex={0}
        presentationMode="single-pane"
        popupManager={{}}
        settingsManager={settingsManager}
        setSelectedIndex={setSelectedIndex}
      />
    );

    await sleep(40);
    tmuxServiceMock.breakPaneToWindow.mockClear();
    tmuxServiceMock.joinPaneToTarget.mockClear();
    tmuxServiceMock.selectPane.mockClear();
    setSelectedIndex.mockClear();

    rerender(
      <Harness
        panes={[pane('1', { hidden: true }), pane('2')]}
        selectedIndex={0}
        presentationMode="single-pane"
        popupManager={{}}
        settingsManager={settingsManager}
        setSelectedIndex={setSelectedIndex}
      />
    );

    await sleep(60);

    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(
      tmuxServiceMock.joinPaneToTarget.mock.calls.some(
        ([sourcePaneId]) => sourcePaneId === '%1'
      )
    ).toBe(false);
    expect(tmuxServiceMock.selectPane).not.toHaveBeenCalled();

    unmount();
  });

  it('does not re-focus hidden panes when every pane is hidden', async () => {
    const setSelectedIndex = vi.fn();
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => 'global'),
    };

    const { rerender, unmount } = render(
      <Harness
        panes={[pane('1'), pane('2')]}
        selectedIndex={0}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={settingsManager}
        setSelectedIndex={setSelectedIndex}
      />
    );

    await sleep(40);
    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    tmuxServiceMock.joinPaneToTarget.mockClear();
    setSelectedIndex.mockClear();

    rerender(
      <Harness
        panes={[pane('1', { hidden: true }), pane('2', { hidden: true })]}
        selectedIndex={0}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={settingsManager}
        setSelectedIndex={setSelectedIndex}
      />
    );

    await sleep(60);

    expect(tmuxServiceMock.selectPane).not.toHaveBeenCalled();
    expect(tmuxServiceMock.setPaneZoom).not.toHaveBeenCalled();
    expect(tmuxServiceMock.joinPaneToTarget).not.toHaveBeenCalled();
    expect(setSelectedIndex).not.toHaveBeenCalled();

    unmount();
  });

  it('reports the corrected hide/show status messages', async () => {
    const hideStatus = vi.fn();
    const showStatus = vi.fn();
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => 'global'),
    };
    const savePanes = vi.fn(async () => {});
    const loadPanes = vi.fn(async () => {});

    const hiddenPane = pane('1', { hidden: true });
    const visiblePane = pane('2');

    const { stdin: hideStdin, unmount: unmountHide } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={settingsManager}
        setStatusMessage={hideStatus}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await sleep(40);
    hideStatus.mockClear();
    hideStdin.write('h');
    await sleep(60);

    expect(hideStatus).toHaveBeenCalledWith('Hid pane-1');

    unmountHide();

    const { stdin: showStdin, unmount: unmountShow } = render(
      <Harness
        panes={[hiddenPane, visiblePane]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={settingsManager}
        setStatusMessage={showStatus}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await sleep(40);
    showStatus.mockClear();
    showStdin.write('h');
    await sleep(60);

    expect(showStatus).toHaveBeenCalledWith('Showing pane-1');

    unmountShow();
  });

  it('keeps the first newly created agent pane active after a focus navigator action reloads panes', async () => {
    const setSelectedIndex = vi.fn();
    const createdPanes = [pane('2'), pane('3')];
    const handlePaneCreationWithAgent = vi.fn(async () => createdPanes);
    const popupManager = {
      launchFocusNavigatorPopup: vi.fn(async () => ({
        kind: 'project',
        action: 'new-agent',
        projectRoot: '/repo',
      })),
      launchNewPanePopup: vi.fn(async () => 'Build the feature'),
    };

    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%1',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { rerender, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    );

    await sleep(80);
    expect(handlePaneCreationWithAgent).toHaveBeenCalledWith('Build the feature', '/repo');

    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    setSelectedIndex.mockClear();

    rerender(
      <Harness
        panes={[pane('1'), ...createdPanes]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    );

    await sleep(80);

    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%2', undefined);
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%2', true);

    unmount();
  });

  it('keeps a new terminal active after a focus navigator action reloads panes', async () => {
    const setSelectedIndex = vi.fn();
    const savePanes = vi.fn(async () => {});
    const loadPanes = vi.fn(async () => {});
    const createdShellPane: DmuxPane = {
      id: 'dmux-2',
      slug: 'shell-2',
      prompt: '',
      paneId: '%2',
      projectRoot: '/repo',
      projectName: 'repo',
      type: 'shell',
      shellType: 'zsh',
    };
    const popupManager = {
      launchFocusNavigatorPopup: vi.fn(async () => ({
        kind: 'project',
        action: 'terminal',
        projectRoot: '/repo',
      })),
    };

    vi.mocked(createShellPane).mockResolvedValue(createdShellPane);
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%1',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { rerender, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await vi.waitFor(() => {
      expect(createShellPane).toHaveBeenCalledWith('%2', 1);
    });

    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    setSelectedIndex.mockClear();

    rerender(
      <Harness
        panes={[pane('1'), createdShellPane]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await vi.waitFor(() => {
      expect(setSelectedIndex).toHaveBeenCalledWith(1);
      expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%2', undefined);
      expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%2', true);
    });

    unmount();
  });

  it('activates a reopened pane after a focus navigator reopen action reloads panes', async () => {
    const setSelectedIndex = vi.fn();
    const reopenedPane = pane('2');
    const handleReopenWorktree = vi.fn(async () => reopenedPane);
    const popupManager = {
      launchFocusNavigatorPopup: vi.fn(async () => ({
        kind: 'project',
        action: 'reopen',
        projectRoot: '/repo',
      })),
      launchReopenWorktreePopup: vi.fn(async () => ({
        action: 'select',
        candidate: {
          branchName: 'feature-a',
          slug: 'feature-a',
          path: '/repo/.dmux/worktrees/feature-a',
          lastModified: '2026-03-12T12:00:00.000Z',
          hasUncommittedChanges: false,
          hasWorktree: true,
          hasLocalBranch: true,
          hasRemoteBranch: false,
          isRemote: false,
        },
      })),
    };

    vi.mocked(getResumableBranches).mockReturnValue([{
      branchName: 'feature-a',
      slug: 'feature-a',
      path: '/repo/.dmux/worktrees/feature-a',
      lastModified: new Date('2026-03-12T12:00:00.000Z'),
      hasUncommittedChanges: false,
      hasWorktree: true,
      hasLocalBranch: true,
      hasRemoteBranch: false,
      isRemote: false,
    }]);
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%1',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { rerender, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        handleReopenWorktree={handleReopenWorktree}
      />
    );

    await sleep(80);
    expect(handleReopenWorktree).toHaveBeenCalled();

    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    setSelectedIndex.mockClear();

    rerender(
      <Harness
        panes={[pane('1'), reopenedPane]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        handleReopenWorktree={handleReopenWorktree}
      />
    );

    await sleep(80);

    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%2', undefined);
    expect(tmuxServiceMock.setPaneZoom).toHaveBeenCalledWith('%2', true);

    unmount();
  });

  it('opens the focus action sheet for pane-row more actions and dispatches the selected pane action', async () => {
    const savePanes = vi.fn(async () => {});
    const loadPanes = vi.fn(async () => {});
    const popupManager = {
      launchFocusNavigatorPopup: vi.fn(async () => ({
        kind: 'pane',
        action: 'more',
        paneId: '1',
      })),
      launchFocusActionSheetPopup: vi.fn(async () => 'toggle_visibility'),
    };

    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%1',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await vi.waitFor(() => {
      expect(popupManager.launchFocusNavigatorPopup).toHaveBeenCalled();
      expect(popupManager.launchFocusActionSheetPopup).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1' }),
        expect.arrayContaining([expect.objectContaining({ id: '1' })])
      );
      expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith('%1', 'dmux-hidden-1');
      expect(savePanes).toHaveBeenCalled();
      expect(loadPanes).toHaveBeenCalled();
    });

    unmount();
  });

  it('keeps the standard pane-anchored kebab menu outside focus mode', async () => {
    const popupManager = {
      launchFocusNavigatorPopup: vi.fn(),
      launchKebabMenuPopup: vi.fn(async () => null),
    };

    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%1',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
      />
    );

    await vi.waitFor(() => {
      expect(popupManager.launchKebabMenuPopup).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1' }),
        expect.arrayContaining([expect.objectContaining({ id: '1' })]),
        expect.objectContaining({ anchorToPane: true })
      );
    });
    expect(popupManager.launchFocusNavigatorPopup).not.toHaveBeenCalled();

    unmount();
  });

  it('opens blank-session project actions from the control pane and dispatches new-agent creation', async () => {
    const handlePaneCreationWithAgent = vi.fn(async () => []);
    const popupManager = {
      launchBlankProjectActionsPopup: vi.fn(async () => 'new-agent'),
      launchNewPanePopup: vi.fn(async () => 'Build the feature'),
    };

    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%0',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { unmount } = render(
      <Harness
        panes={[]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    );

    await vi.waitFor(() => {
      expect(popupManager.launchBlankProjectActionsPopup).toHaveBeenCalledWith('repo', '/repo');
      expect(popupManager.launchNewPanePopup).toHaveBeenCalledWith('/repo');
      expect(handlePaneCreationWithAgent).toHaveBeenCalledWith('Build the feature', '/repo');
    });

    unmount();
  });

  it('opens blank-session project actions from the welcome pane and dispatches terminal creation', async () => {
    const savePanes = vi.fn(async () => {});
    const loadPanes = vi.fn(async () => {});
    const popupManager = {
      launchBlankProjectActionsPopup: vi.fn(async () => 'terminal'),
    };

    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%welcome',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { unmount } = render(
      <Harness
        panes={[]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    );

    await vi.waitFor(() => {
      expect(popupManager.launchBlankProjectActionsPopup).toHaveBeenCalledWith('repo', '/repo');
      expect(createShellPane).toHaveBeenCalled();
      expect(savePanes).toHaveBeenCalled();
      expect(loadPanes).toHaveBeenCalled();
    });

    unmount();
  });

  it('dispatches reopen from blank-session project actions', async () => {
    const handleReopenWorktree = vi.fn(async () => pane('2'));
    const popupManager = {
      launchBlankProjectActionsPopup: vi.fn(async () => 'reopen'),
      launchReopenWorktreePopup: vi.fn(async () => ({
        action: 'select',
        candidate: {
          branchName: 'feature-a',
          slug: 'feature-a',
          path: '/repo/.dmux/worktrees/feature-a',
          lastModified: '2026-03-12T12:00:00.000Z',
          hasUncommittedChanges: false,
          hasWorktree: true,
          hasLocalBranch: true,
          hasRemoteBranch: false,
          isRemote: false,
        },
      })),
    };

    vi.mocked(getResumableBranches).mockReturnValue([{
      branchName: 'feature-a',
      slug: 'feature-a',
      path: '/repo/.dmux/worktrees/feature-a',
      lastModified: new Date('2026-03-12T12:00:00.000Z'),
      hasUncommittedChanges: false,
      hasWorktree: true,
      hasLocalBranch: true,
      hasRemoteBranch: false,
      isRemote: false,
    }]);
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%welcome',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { unmount } = render(
      <Harness
        panes={[]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        handleReopenWorktree={handleReopenWorktree}
      />
    );

    await vi.waitFor(() => {
      expect(popupManager.launchBlankProjectActionsPopup).toHaveBeenCalledWith('repo', '/repo');
      expect(popupManager.launchReopenWorktreePopup).toHaveBeenCalled();
      expect(handleReopenWorktree).toHaveBeenCalled();
    });

    unmount();
  });

  it('shows a friendly status when the remote menu is triggered from an unmanaged pane after panes exist', async () => {
    const setStatusMessage = vi.fn();
    const popupManager = {
      launchBlankProjectActionsPopup: vi.fn(),
      launchKebabMenuPopup: vi.fn(),
      launchFocusNavigatorPopup: vi.fn(),
    };

    vi.mocked(getCurrentTmuxSessionName).mockReturnValue('dmux-test');
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: 'pane-shortcut',
        targetPaneId: '%0',
        shortcut: 'm',
        createdAt: '2026-03-23T03:00:00.000Z',
      }])
      .mockResolvedValue([]);

    const { unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setStatusMessage={setStatusMessage}
      />
    );

    await vi.waitFor(() => {
      expect(setStatusMessage).toHaveBeenCalledWith('Focus a dmux pane to open pane actions');
    });
    expect(popupManager.launchBlankProjectActionsPopup).not.toHaveBeenCalled();
    expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled();
    expect(popupManager.launchFocusNavigatorPopup).not.toHaveBeenCalled();

    unmount();
  });

  it('isolates and activates a newly created pane in single-pane mode', async () => {
    const setSelectedIndex = vi.fn();
    const savePanes = vi.fn(async () => {});
    const loadPanes = vi.fn(async () => {});
    const handlePaneCreationWithAgent = vi.fn(async () => [pane('2')]);
    const popupManager = {
      launchNewPanePopup: vi.fn(async () => 'Draft the plan'),
    };

    const { stdin, rerender, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="single-pane"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        savePanes={savePanes}
        loadPanes={loadPanes}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    );

    await sleep(40);
    stdin.write('n');
    await sleep(60);

    tmuxServiceMock.breakPaneToWindow.mockClear();
    tmuxServiceMock.selectPane.mockClear();
    setSelectedIndex.mockClear();
    savePanes.mockClear();
    loadPanes.mockClear();

    rerender(
      <Harness
        panes={[pane('1'), pane('2')]}
        presentationMode="single-pane"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        savePanes={savePanes}
        loadPanes={loadPanes}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    );

    await sleep(80);

    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith('%1', 'dmux-hidden-1');
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%2');
    expect(savePanes).toHaveBeenCalledWith([
      expect.objectContaining({ id: '1', hidden: true }),
      expect.objectContaining({ id: '2', hidden: false }),
    ]);

    unmount();
  });

  it('does not auto-switch to new panes in grid mode', async () => {
    const setSelectedIndex = vi.fn();
    const handlePaneCreationWithAgent = vi.fn(async () => [pane('2')]);
    const popupManager = {
      launchNewPanePopup: vi.fn(async () => 'Draft the plan'),
    };

    const { stdin, rerender, unmount } = render(
      <Harness
        panes={[pane('1')]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    );

    await sleep(40);
    stdin.write('n');
    await sleep(60);

    tmuxServiceMock.selectPane.mockClear();
    tmuxServiceMock.setPaneZoom.mockClear();
    setSelectedIndex.mockClear();

    rerender(
      <Harness
        panes={[pane('1'), pane('2')]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => 'global'),
        }}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    );

    await sleep(60);

    expect(setSelectedIndex).not.toHaveBeenCalledWith(1);
    expect(
      tmuxServiceMock.selectPane.mock.calls.some(([paneId]) => paneId === '%2')
    ).toBe(false);
    expect(tmuxServiceMock.setPaneZoom).not.toHaveBeenCalledWith('%2', true);

    unmount();
  });
});
