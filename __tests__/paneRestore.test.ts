import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmuxPane } from '../src/types.js';

const tmuxServiceMock = vi.hoisted(() => ({
  setPaneTitle: vi.fn(async () => {}),
  sendKeys: vi.fn(async () => {}),
  sendShellCommand: vi.fn(async () => {}),
  sendTmuxKeys: vi.fn(async () => {}),
  selectLayout: vi.fn(async () => {}),
  refreshClient: vi.fn(async () => {}),
}));

const splitPaneMock = vi.hoisted(() => vi.fn(() => '%9'));
const paneLifecycleManagerMock = vi.hoisted(() => ({
  isClosing: vi.fn(() => false),
}));

vi.mock('../src/services/TmuxService.js', () => ({
  TmuxService: {
    getInstance: vi.fn(() => tmuxServiceMock),
  },
}));

vi.mock('../src/services/PaneLifecycleManager.js', () => ({
  PaneLifecycleManager: {
    getInstance: vi.fn(() => paneLifecycleManagerMock),
  },
}));

vi.mock('../src/utils/tmux.js', () => ({
  splitPane: splitPaneMock,
}));

vi.mock('../src/utils/geminiTrust.js', () => ({
  ensureGeminiFolderTrusted: vi.fn(),
}));

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

describe('pane restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    splitPaneMock.mockReturnValue('%9');
  });

  it('restores missing panes with quoted banner, preview, cwd, and resume commands', async () => {
    const { recreateMissingPanes } = await import('../src/hooks/usePaneLoading.js');

    const prompt = `Let's debug

quoted restore behavior after reopen`;
    const expectedPreview = prompt.replace(/\s+/g, ' ').trim().substring(0, 50);
    const worktreePath = `/repo/o'clock/.dmux/worktrees/feature-codex`;
    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt,
      paneId: '%2',
      worktreePath,
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    await recreateMissingPanes([pane], '/repo/.dmux/dmux.config.json');

    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      1,
      '%9',
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      2,
      '%9',
      `printf '%s\\n' ${shellQuote(`# Original prompt: ${expectedPreview}...`)}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      3,
      '%9',
      `cd ${shellQuote(worktreePath)}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenCalledWith(
      '%9',
      'codex resume --last --dangerously-bypass-approvals-and-sandbox'
    );
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenCalledTimes(4);
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(1, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(2, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(3, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(4, '%9', 'Enter');
    expect(tmuxServiceMock.sendKeys).not.toHaveBeenCalled();
  });

  it('restores killed worktree panes with the same safe shell-command flow', async () => {
    const { recreateKilledWorktreePanes } = await import('../src/hooks/usePaneLoading.js');

    const prompt = `Let's keep
      the restore command safe even after a kill and reopen cycle`;
    const expectedPreview = prompt.replace(/\s+/g, ' ').trim().substring(0, 50);
    const worktreePath = `/repo/o'clock/.dmux/worktrees/feature-codex`;
    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt,
      paneId: '%2',
      worktreePath,
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    const updatedPanes = await recreateKilledWorktreePanes(
      [pane],
      [],
      '/repo/.dmux/dmux.config.json'
    );

    expect(updatedPanes).toEqual([{ ...pane, paneId: '%9' }]);
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      1,
      '%9',
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      2,
      '%9',
      `printf '%s\\n' ${shellQuote(`# Original prompt: ${expectedPreview}...`)}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      3,
      '%9',
      `cd ${shellQuote(worktreePath)}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenCalledWith(
      '%9',
      'codex resume --last --dangerously-bypass-approvals-and-sandbox'
    );
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenCalledTimes(4);
    expect(tmuxServiceMock.sendKeys).not.toHaveBeenCalled();
  });
});
