import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRestoreInfoCommand(message: string): string {
  return `printf '%s\\n' ${shellQuote(message)}`;
}

const apostrophePrompt =
  "Let's review the SOTA of the wiggum pattern online and compare it to our repo";
const promptPreview = `${apostrophePrompt.substring(0, 50)}...`;

function createPane(overrides: Partial<DmuxPane> = {}): DmuxPane {
  return {
    id: 'dmux-1',
    slug: 'feature-codex',
    prompt: apostrophePrompt,
    paneId: '%2',
    worktreePath: '/repo/.dmux/worktrees/feature-codex',
    projectRoot: '/repo',
    agent: 'codex',
    permissionMode: 'bypassPermissions',
    ...overrides,
  };
}

async function createTempConfigFile(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmux-pane-restore-'));
  const file = path.join(dir, 'dmux.config.json');
  await fs.writeFile(file, contents, 'utf-8');
  return file;
}

describe('pane restoration', () => {
  let tempPaths: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    splitPaneMock.mockReturnValue('%9');
  });

  afterEach(async () => {
    await Promise.all(
      tempPaths.map(async (tempPath) => {
        await fs.rm(path.dirname(tempPath), { recursive: true, force: true });
      })
    );
    tempPaths = [];
  });

  it('restores missing panes with safe shell commands when the prompt contains apostrophes', async () => {
    const { recreateMissingPanes } = await import('../src/hooks/usePaneLoading.js');
    const pane = createPane();

    await recreateMissingPanes([pane], '/repo/.dmux/dmux.config.json');

    expect(tmuxServiceMock.sendKeys).not.toHaveBeenCalled();
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      1,
      '%9',
      buildRestoreInfoCommand('# Pane restored: feature-codex')
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      2,
      '%9',
      buildRestoreInfoCommand(`# Original prompt: ${promptPreview}`)
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      3,
      '%9',
      `cd ${shellQuote('/repo/.dmux/worktrees/feature-codex')}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      4,
      '%9',
      'codex resume --last --dangerously-bypass-approvals-and-sandbox'
    );
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenCalledTimes(4);
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(1, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(2, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(3, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(4, '%9', 'Enter');
  });

  it('restores killed worktree panes with safe shell commands when the prompt contains apostrophes', async () => {
    const { recreateKilledWorktreePanes } = await import('../src/hooks/usePaneLoading.js');
    const pane = createPane({ paneId: '%3' });
    const panesFile = await createTempConfigFile('{}');
    tempPaths.push(panesFile);

    const updatedPanes = await recreateKilledWorktreePanes([pane], [], panesFile);

    expect(updatedPanes).toEqual([{ ...pane, paneId: '%9' }]);
    expect(tmuxServiceMock.sendKeys).not.toHaveBeenCalled();
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      1,
      '%9',
      buildRestoreInfoCommand('# Pane restored: feature-codex')
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      2,
      '%9',
      buildRestoreInfoCommand(`# Original prompt: ${promptPreview}`)
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      3,
      '%9',
      `cd ${shellQuote('/repo/.dmux/worktrees/feature-codex')}`
    );
    expect(tmuxServiceMock.sendShellCommand).toHaveBeenNthCalledWith(
      4,
      '%9',
      'codex resume --last --dangerously-bypass-approvals-and-sandbox'
    );
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenCalledTimes(4);
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(1, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(2, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(3, '%9', 'Enter');
    expect(tmuxServiceMock.sendTmuxKeys).toHaveBeenNthCalledWith(4, '%9', 'Enter');
  });
});
