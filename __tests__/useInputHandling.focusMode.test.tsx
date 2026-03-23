import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useInputHandling } from '../src/hooks/useInputHandling.js';
import { TmuxService } from '../src/services/TmuxService.js';
import type { DmuxPane } from '../src/types.js';

vi.mock('../src/utils/remotePaneActions.js', () => ({
  drainRemotePaneActions: vi.fn(async () => []),
  getCurrentTmuxSessionName: vi.fn(() => null),
}));

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
  presentationMode,
  popupManager,
  settingsManager,
  controlPaneId = '%0',
  setStatusMessage = vi.fn(),
  savePanes = vi.fn(async () => {}),
  loadPanes = vi.fn(async () => {}),
}: {
  panes: DmuxPane[];
  presentationMode: 'grid' | 'single-pane' | 'focus';
  popupManager: any;
  settingsManager: any;
  controlPaneId?: string;
  setStatusMessage?: ReturnType<typeof vi.fn>;
  savePanes?: ReturnType<typeof vi.fn>;
  loadPanes?: ReturnType<typeof vi.fn>;
}) {
  useInputHandling({
    panes,
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
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
    handlePaneCreationWithAgent: vi.fn(),
    handleCreateChildWorktree: vi.fn(),
    handleReopenWorktree: vi.fn(),
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
});
