import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useInputHandling } from '../src/hooks/useInputHandling.js';
import { TmuxService } from '../src/services/TmuxService.js';

vi.mock('../src/utils/remotePaneActions.js', () => ({
  drainRemotePaneActions: vi.fn(async () => []),
  getCurrentTmuxSessionName: vi.fn(() => null),
}));

const CTRL_C = '\u0003';
const ESC = '\u001b';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Harness({
  cleanExit = vi.fn(),
  setStatusMessage = vi.fn(),
  onQuitConfirmModeChange = vi.fn(),
}: {
  cleanExit?: ReturnType<typeof vi.fn>;
  setStatusMessage?: ReturnType<typeof vi.fn>;
  onQuitConfirmModeChange?: ReturnType<typeof vi.fn>;
}) {
  const [quitConfirmMode, setQuitConfirmModeState] = useState(false);

  useInputHandling({
    panes: [],
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
    isCreatingPane: false,
    setIsCreatingPane: vi.fn(),
    runningCommand: false,
    isUpdating: false,
    isLoading: false,
    ignoreInput: false,
    isDevMode: false,
    quitConfirmMode,
    setQuitConfirmMode: (value) => {
      onQuitConfirmModeChange(value);
      setQuitConfirmModeState(value);
    },
    showCommandPrompt: null,
    setShowCommandPrompt: vi.fn(),
    commandInput: '',
    setCommandInput: vi.fn(),
    showFileCopyPrompt: false,
    setShowFileCopyPrompt: vi.fn(),
    currentCommandType: null,
    setCurrentCommandType: vi.fn(),
    projectSettings: {},
    saveSettings: vi.fn(async () => {}),
    settingsManager: {},
    popupManager: {} as any,
    actionSystem: {
      actionState: {},
      executeAction: vi.fn(async () => {}),
      executeCallback: vi.fn(async (callback: any) => callback?.()),
      clearDialog: vi.fn(),
      clearStatus: vi.fn(),
      setActionState: vi.fn(),
    },
    controlPaneId: '%0',
    trackProjectActivity: vi.fn(async (work: () => unknown) => await work()),
    presentationMode: 'grid',
    popupsSupported: true,
    setStatusMessage,
    copyNonGitFiles: vi.fn(async () => {}),
    runCommandInternal: vi.fn(async () => {}),
    handlePaneCreationWithAgent: vi.fn(async () => []),
    handleCreateChildWorktree: vi.fn(async () => []),
    handleReopenWorktree: vi.fn(async () => null),
    setDevSourceFromPane: vi.fn(async () => {}),
    savePanes: vi.fn(async () => {}),
    sidebarProjects: [],
    saveSidebarProjects: vi.fn(async (projects) => projects),
    loadPanes: vi.fn(async () => {}),
    cleanExit,
    availableAgents: [],
    panesFile: '/repo/.dmux/dmux.config.json',
    projectRoot: '/repo',
    projectActionItems: [],
    findCardInDirection: vi.fn(() => null),
  });

  return <Text>{quitConfirmMode ? 'armed' : 'idle'}</Text>;
}

describe('useInputHandling quit shortcuts', () => {
  const originalTmuxEnv = process.env.TMUX;
  const tmuxServiceMock = {
    detachCurrentClient: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TMUX = '/tmp/tmux-test';
    vi.spyOn(TmuxService, 'getInstance').mockReturnValue(
      tmuxServiceMock as unknown as TmuxService
    );
  });

  afterEach(() => {
    if (originalTmuxEnv === undefined) {
      delete process.env.TMUX;
    } else {
      process.env.TMUX = originalTmuxEnv;
    }
    vi.restoreAllMocks();
  });

  it('arms quit confirmation on the first q press without detaching', async () => {
    const cleanExit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} />
    );

    await sleep(20);
    stdin.write('q');
    await sleep(20);

    expect(lastFrame()).toContain('armed');
    expect(tmuxServiceMock.detachCurrentClient).not.toHaveBeenCalled();
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('detaches on the second q press', async () => {
    const cleanExit = vi.fn();
    const { stdin, unmount } = render(<Harness cleanExit={cleanExit} />);

    await sleep(20);
    stdin.write('q');
    await sleep(20);
    stdin.write('q');
    await sleep(20);

    expect(tmuxServiceMock.detachCurrentClient).toHaveBeenCalledTimes(1);
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('arms quit confirmation on the first Ctrl+C press and detaches on the second', async () => {
    const cleanExit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} />
    );

    await sleep(20);
    stdin.write(CTRL_C);
    await sleep(20);
    expect(lastFrame()).toContain('armed');

    stdin.write(CTRL_C);
    await sleep(20);

    expect(tmuxServiceMock.detachCurrentClient).toHaveBeenCalledTimes(1);
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it.each([
    ['q then Ctrl+C', 'q', CTRL_C],
    ['Ctrl+C then q', CTRL_C, 'q'],
  ])('supports mixed confirmation with %s', async (_label, first, second) => {
    const cleanExit = vi.fn();
    const { stdin, unmount } = render(<Harness cleanExit={cleanExit} />);

    await sleep(20);
    stdin.write(first);
    await sleep(20);
    stdin.write(second);
    await sleep(20);

    expect(tmuxServiceMock.detachCurrentClient).toHaveBeenCalledTimes(1);
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('cancels quit confirmation on Escape', async () => {
    const cleanExit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} />
    );

    await sleep(20);
    stdin.write('q');
    await sleep(20);
    expect(lastFrame()).toContain('armed');

    stdin.write(ESC);
    await sleep(20);

    expect(lastFrame()).toContain('idle');
    expect(tmuxServiceMock.detachCurrentClient).not.toHaveBeenCalled();
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('does not detach on ordinary input while confirmation is armed', async () => {
    const cleanExit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} />
    );

    await sleep(20);
    stdin.write('q');
    await sleep(20);
    stdin.write('j');
    await sleep(20);

    expect(lastFrame()).toContain('armed');
    expect(tmuxServiceMock.detachCurrentClient).not.toHaveBeenCalled();
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('falls back to cleanExit when not running inside tmux', async () => {
    const cleanExit = vi.fn();
    delete process.env.TMUX;

    const { stdin, unmount } = render(<Harness cleanExit={cleanExit} />);

    await sleep(20);
    stdin.write('q');
    await sleep(20);
    stdin.write('q');
    await sleep(20);

    expect(cleanExit).toHaveBeenCalledTimes(1);
    expect(tmuxServiceMock.detachCurrentClient).not.toHaveBeenCalled();

    unmount();
  });

  it('shows a status error and clears confirmation when detaching fails', async () => {
    const cleanExit = vi.fn();
    const setStatusMessage = vi.fn();
    tmuxServiceMock.detachCurrentClient.mockRejectedValueOnce(
      new Error('No active tmux client could be resolved for detach')
    );

    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} setStatusMessage={setStatusMessage} />
    );

    await sleep(20);
    stdin.write('q');
    await sleep(20);
    expect(lastFrame()).toContain('armed');

    stdin.write('q');
    await sleep(20);

    expect(lastFrame()).toContain('idle');
    expect(setStatusMessage).toHaveBeenCalledWith(
      'Failed to detach from dmux session: No active tmux client could be resolved for detach'
    );
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });
});
