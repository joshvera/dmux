import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn(() => JSON.stringify({ controlPaneId: '%0' })),
}));

const tmuxServiceMock = vi.hoisted(() => ({
  getCurrentPaneIdSync: vi.fn(() => '%0'),
  paneExists: vi.fn(async () => true),
  setPaneTitle: vi.fn(async () => {}),
  refreshClient: vi.fn(async () => {}),
  sendShellCommand: vi.fn(async () => {}),
  sendTmuxKeys: vi.fn(async () => {}),
  selectPane: vi.fn(async () => {}),
  setPaneZoom: vi.fn(async () => {}),
}));

const splitPaneMock = vi.hoisted(() => vi.fn(() => '%1'));
const recalculateAndApplyLayoutMock = vi.hoisted(() => vi.fn(async () => {}));
const launchAgentInPaneMock = vi.hoisted(() => vi.fn(async () => {}));
const autoApproveTrustPromptMock = vi.hoisted(() => vi.fn(async () => {}));
const getSettingsMock = vi.hoisted(() => vi.fn(() => ({
  permissionMode: 'bypassPermissions',
  enableAutopilotByDefault: false,
  presentationMode: 'focus',
})));

vi.mock('fs', () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock('../src/services/TmuxService.js', () => ({
  TmuxService: {
    getInstance: vi.fn(() => tmuxServiceMock),
  },
}));

vi.mock('../src/utils/tmux.js', () => ({
  splitPane: splitPaneMock,
  getTerminalDimensions: vi.fn(() => ({ width: 160, height: 40 })),
}));

vi.mock('../src/utils/layoutManager.js', () => ({
  recalculateAndApplyLayout: recalculateAndApplyLayoutMock,
}));

vi.mock('../src/utils/paneTitle.js', () => ({
  buildWorktreePaneTitle: vi.fn((slug: string) => slug),
}));

vi.mock('../src/utils/settingsManager.js', () => ({
  SettingsManager: vi.fn(() => ({
    getSettings: getSettingsMock,
  })),
}));

vi.mock('../src/utils/agentLaunch.js', () => ({
  launchAgentInPane: launchAgentInPaneMock,
}));

vi.mock('../src/utils/paneCreation.js', () => ({
  autoApproveTrustPrompt: autoApproveTrustPromptMock,
}));

describe('attachAgentToWorktree focus mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({
      permissionMode: 'bypassPermissions',
      enableAutopilotByDefault: false,
      presentationMode: 'focus',
    });
  });

  it('does not preserve zoom semantics when attaching an agent in focus mode', async () => {
    const { attachAgentToWorktree } = await import('../src/utils/attachAgent.js');

    await attachAgentToWorktree({
      targetPane: {
        id: 'pane-1',
        slug: 'feature-a',
        prompt: 'prompt',
        paneId: '%1',
        projectRoot: '/repo',
        projectName: 'repo',
        worktreePath: '/repo/.dmux/worktrees/feature-a',
        branchName: 'feature-a',
      },
      prompt: 'attach another agent',
      agent: 'codex',
      existingPanes: [
        {
          id: 'pane-1',
          slug: 'feature-a',
          prompt: 'prompt',
          paneId: '%1',
          projectRoot: '/repo',
          projectName: 'repo',
          worktreePath: '/repo/.dmux/worktrees/feature-a',
          branchName: 'feature-a',
        },
      ],
      sessionProjectRoot: '/repo',
      sessionConfigPath: '/repo/.dmux/dmux.config.json',
    });

    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%1');
    expect(tmuxServiceMock.setPaneZoom).not.toHaveBeenCalled();
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith('%0');
  });

  it('falls back to the control pane when all existing panes are hidden', async () => {
    const { attachAgentToWorktree } = await import('../src/utils/attachAgent.js');

    await attachAgentToWorktree({
      targetPane: {
        id: 'pane-1',
        slug: 'feature-a',
        prompt: 'prompt',
        paneId: '%1',
        projectRoot: '/repo',
        projectName: 'repo',
        worktreePath: '/repo/.dmux/worktrees/feature-a',
        branchName: 'feature-a',
      },
      prompt: 'attach another agent',
      agent: 'codex',
      existingPanes: [
        {
          id: 'pane-1',
          slug: 'feature-a',
          prompt: 'prompt',
          paneId: '%1',
          hidden: true,
          projectRoot: '/repo',
          projectName: 'repo',
          worktreePath: '/repo/.dmux/worktrees/feature-a',
          branchName: 'feature-a',
        },
        {
          id: 'pane-2',
          slug: 'feature-b',
          prompt: 'prompt',
          paneId: '%2',
          hidden: true,
          projectRoot: '/repo',
          projectName: 'repo',
          worktreePath: '/repo/.dmux/worktrees/feature-b',
          branchName: 'feature-b',
        },
      ],
      sessionProjectRoot: '/repo',
      sessionConfigPath: '/repo/.dmux/dmux.config.json',
    });

    expect(splitPaneMock).toHaveBeenCalledWith({
      targetPane: '%0',
      cwd: '/repo',
    });
  });
});
