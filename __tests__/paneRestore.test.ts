import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import { buildPaneRestoreCommands } from '../src/utils/paneRestore.js';
import { shellQuote } from '../src/utils/shellQuote.js';

const tmuxServiceMock = vi.hoisted(() => ({
  setPaneTitle: vi.fn(async () => {}),
  sendKeys: vi.fn(async () => {}),
  sendShellCommand: vi.fn(async () => {}),
  sendTmuxKeys: vi.fn(async () => {}),
  selectLayout: vi.fn(async () => {}),
  refreshClient: vi.fn(async () => {}),
}));

const splitPaneMock = vi.hoisted(() => vi.fn(() => '%9'));

vi.mock('../src/services/TmuxService.js', () => ({
  TmuxService: {
    getInstance: vi.fn(() => tmuxServiceMock),
  },
}));

vi.mock('../src/utils/tmux.js', () => ({
  splitPane: splitPaneMock,
}));

vi.mock('../src/utils/geminiTrust.js', () => ({
  ensureGeminiFolderTrusted: vi.fn(),
}));

describe('pane restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    splitPaneMock.mockReturnValue('%9');
  });

  it('builds quoted restore commands with a normalized prompt preview and resume command', () => {
    const prompt = `Let's debug\n\nquoted restore behavior after reopen`;
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

    expect(buildPaneRestoreCommands(pane, '/fallback')).toEqual([
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`,
      `printf '%s\\n' ${shellQuote(`# Original prompt: ${expectedPreview}...`)}`,
      `cd ${shellQuote(worktreePath)}`,
      'codex resume --last --dangerously-bypass-approvals-and-sandbox',
    ]);
  });

  it('omits the preview banner when the prompt is blank after normalization', () => {
    const worktreePath = `/repo/o'clock/.dmux/worktrees/feature-codex`;
    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt: ' \n\t ',
      paneId: '%2',
      worktreePath,
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    expect(buildPaneRestoreCommands(pane, '/fallback')).toEqual([
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`,
      `cd ${shellQuote(worktreePath)}`,
      'codex resume --last --dangerously-bypass-approvals-and-sandbox',
    ]);
  });

  it('omits the resume command when the pane has no agent', () => {
    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt: 'review restore behavior',
      paneId: '%2',
      projectRoot: '/repo',
    };

    expect(buildPaneRestoreCommands(pane, '/fallback')).toEqual([
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`,
      `printf '%s\\n' ${shellQuote('# Original prompt: review restore behavior...')}`,
      `cd ${shellQuote('/fallback')}`,
    ]);
  });

  it('resumes restored worktree panes with their original agent command', async () => {
    const { recreateMissingPanes } = await import('../src/hooks/usePaneLoading.js');

    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt: 'fix the failing tests',
      paneId: '%2',
      worktreePath: '/repo/.dmux/worktrees/feature-codex',
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    await recreateMissingPanes([pane], '/repo/.dmux/dmux.config.json');

    expect(tmuxServiceMock.sendShellCommand).toHaveBeenCalledWith(
      '%9',
      expect.stringContaining(
        "export DMUX_PANE_ID='dmux-1'; export DMUX_TMUX_PANE_ID='%9'; codex --enable codex_hooks resume --last --dangerously-bypass-approvals-and-sandbox"
      )
    );
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenCalledWith('%9', 'Enter');
  });
});
