import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import { loadAndProcessPanes } from '../src/hooks/usePaneLoading.js';

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

const tmuxServiceMock = vi.hoisted(() => ({
  getAllPaneInfo: vi.fn(),
  getAllPaneIds: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock('../src/services/TmuxService.js', () => ({
  TmuxService: {
    getInstance: vi.fn(() => tmuxServiceMock),
  },
}));

vi.mock('../src/services/LogService.js', () => ({
  LogService: {
    getInstance: vi.fn(() => ({
      on: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('../src/shared/StateManager.js', () => ({
  StateManager: {
    getInstance: vi.fn(() => ({
      getState: vi.fn(() => ({ projectRoot: '/repo' })),
    })),
  },
  default: {
    getInstance: vi.fn(() => ({
      getState: vi.fn(() => ({ projectRoot: '/repo' })),
    })),
  },
}));

function pane(overrides: Partial<DmuxPane> = {}): DmuxPane {
  return {
    id: 'dmux-1',
    slug: 'feature',
    prompt: 'prompt',
    paneId: '%1',
    hidden: false,
    projectRoot: '/repo',
    ...overrides,
  };
}

describe('loadAndProcessPanes hidden state sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.readFile.mockResolvedValue(JSON.stringify({
      projectRoot: '/repo',
      projectName: 'repo',
      panes: [pane()],
    }));
    tmuxServiceMock.getAllPaneInfo.mockResolvedValue([
      {
        paneId: '%0',
        title: 'dmux',
        left: 0,
        top: 0,
        width: 40,
        height: 24,
      },
      {
        paneId: '%1',
        title: 'feature',
        left: 41,
        top: 0,
        width: 80,
        height: 24,
      },
    ]);
  });

  it('reports hidden-state changes when config visibility is stale', async () => {
    tmuxServiceMock.getAllPaneIds.mockResolvedValue(['%0']);

    const result = await loadAndProcessPanes('/repo/.dmux/dmux.config.json', true);

    expect(result.hiddenStateChangedFromConfig).toBe(true);
    expect(result.panes).toEqual([
      expect.objectContaining({
        id: 'dmux-1',
        paneId: '%1',
        hidden: true,
      }),
    ]);
  });

  it('does not report changes when tmux topology matches config', async () => {
    tmuxServiceMock.getAllPaneIds.mockResolvedValue(['%0', '%1']);

    const result = await loadAndProcessPanes('/repo/.dmux/dmux.config.json', true);

    expect(result.hiddenStateChangedFromConfig).toBe(false);
    expect(result.panes).toEqual([
      expect.objectContaining({
        id: 'dmux-1',
        paneId: '%1',
        hidden: false,
      }),
    ]);
  });
});
