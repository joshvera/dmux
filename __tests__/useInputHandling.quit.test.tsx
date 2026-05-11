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
    showInlineSettings: false,
    setShowInlineSettings: vi.fn(),
    inlineSettingsIndex: 0,
    setInlineSettingsIndex: vi.fn(),
    inlineSettingsMode: 'list',
    setInlineSettingsMode: vi.fn(),
    inlineSettingsEditingKey: undefined,
    setInlineSettingsEditingKey: vi.fn(),
    inlineSettingsEditingValueIndex: 0,
    setInlineSettingsEditingValueIndex: vi.fn(),
    inlineSettingsScopeIndex: 0,
    setInlineSettingsScopeIndex: vi.fn(),
    inlineSettingsProjectRoot: undefined,
    setInlineSettingsProjectRoot: vi.fn(),
    resetInlineSettings: vi.fn(),
    projectSettings: {},
    saveSettings: vi.fn(async () => {}),
    settingsManager: {},
    getSettingsManagerForProjectRoot: vi.fn(() => ({})),
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
    enterDetachConfirmMode: vi.fn(async () => {}),
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

  it('enters tmux detach confirm mode on the first q press without arming shared confirmation', async () => {
    const cleanExit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} />
    );

    await sleep(20);
    stdin.write('q');
    await sleep(20);

    expect(lastFrame()).toContain('idle');
    expect(tmuxServiceMock.enterDetachConfirmMode).toHaveBeenCalledTimes(1);
    expect(tmuxServiceMock.detachCurrentClient).not.toHaveBeenCalled();
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('enters tmux detach confirm mode on the first Ctrl+C press without arming shared confirmation', async () => {
    const cleanExit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} />
    );

    await sleep(20);
    stdin.write(CTRL_C);
    await sleep(20);

    expect(lastFrame()).toContain('idle');
    expect(tmuxServiceMock.enterDetachConfirmMode).toHaveBeenCalledTimes(1);
    expect(tmuxServiceMock.detachCurrentClient).not.toHaveBeenCalled();
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('shows a status error and keeps confirmation idle when entering tmux detach confirm mode fails', async () => {
    const cleanExit = vi.fn();
    const setStatusMessage = vi.fn();
    tmuxServiceMock.enterDetachConfirmMode.mockRejectedValueOnce(
      new Error('switch-client failed')
    );

    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} setStatusMessage={setStatusMessage} />
    );

    await sleep(20);
    stdin.write('q');
    await sleep(20);

    expect(lastFrame()).toContain('idle');
    expect(setStatusMessage).toHaveBeenCalledWith(
      'Failed to arm detach confirmation: switch-client failed'
    );
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('arms quit confirmation on the first q press and exits on the second outside tmux', async () => {
    const cleanExit = vi.fn();
    delete process.env.TMUX;

    const { stdin, lastFrame, unmount } = render(<Harness cleanExit={cleanExit} />);

    await sleep(20);
    stdin.write('q');
    await sleep(20);
    expect(lastFrame()).toContain('armed');

    stdin.write('q');
    await sleep(20);

    expect(cleanExit).toHaveBeenCalledTimes(1);
    expect(tmuxServiceMock.enterDetachConfirmMode).not.toHaveBeenCalled();

    unmount();
  });

  it('arms quit confirmation on the first Ctrl+C press and exits on the second outside tmux', async () => {
    const cleanExit = vi.fn();
    delete process.env.TMUX;

    const { stdin, lastFrame, unmount } = render(<Harness cleanExit={cleanExit} />);

    await sleep(20);
    stdin.write(CTRL_C);
    await sleep(20);
    expect(lastFrame()).toContain('armed');

    stdin.write(CTRL_C);
    await sleep(20);

    expect(cleanExit).toHaveBeenCalledTimes(1);
    expect(tmuxServiceMock.enterDetachConfirmMode).not.toHaveBeenCalled();

    unmount();
  });

  it.each([
    ['q then Ctrl+C', 'q', CTRL_C],
    ['Ctrl+C then q', CTRL_C, 'q'],
  ])('supports mixed confirmation outside tmux with %s', async (_label, first, second) => {
    const cleanExit = vi.fn();
    delete process.env.TMUX;

    const { stdin, unmount } = render(<Harness cleanExit={cleanExit} />);

    await sleep(20);
    stdin.write(first);
    await sleep(20);
    stdin.write(second);
    await sleep(20);

    expect(cleanExit).toHaveBeenCalledTimes(1);
    expect(tmuxServiceMock.enterDetachConfirmMode).not.toHaveBeenCalled();

    unmount();
  });

  it('cancels shared quit confirmation on Escape outside tmux', async () => {
    const cleanExit = vi.fn();
    delete process.env.TMUX;

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
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });

  it('does not exit on ordinary input while shared confirmation is armed outside tmux', async () => {
    const cleanExit = vi.fn();
    delete process.env.TMUX;

    const { stdin, lastFrame, unmount } = render(
      <Harness cleanExit={cleanExit} />
    );

    await sleep(20);
    stdin.write('q');
    await sleep(20);
    stdin.write('j');
    await sleep(20);

    expect(lastFrame()).toContain('armed');
    expect(cleanExit).not.toHaveBeenCalled();

    unmount();
  });
});
