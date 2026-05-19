import { describe, expect, it } from 'vitest';
import {
  buildSetSessionOptionCommand,
  TmuxService,
} from '../src/services/TmuxService.js';

describe('TmuxService session options', () => {
  it('builds quiet quoted session option commands', () => {
    expect(buildSetSessionOptionCommand(
      "dmux weird'session",
      'pane-active-border-style',
      'fg=colour39 bg=default'
    )).toBe(
      "tmux set-option -q -t 'dmux weird'\\''session' pane-active-border-style 'fg=colour39 bg=default'"
    );
  });

  it('normalizes current-pane perf context at the service boundary', async () => {
    const service = TmuxService.getInstance();
    const executeCalls: Array<{
      command: string;
      options: { metadata?: Record<string, unknown> };
    }> = [];
    const executeNonBlocking = service as unknown as {
      executeNonBlocking: (
        command: string,
        options: { metadata?: Record<string, unknown> }
      ) => Promise<string>;
      getCurrentPaneId: (context?: unknown) => Promise<string>;
    };
    const originalExecuteNonBlocking = executeNonBlocking.executeNonBlocking;

    executeNonBlocking.executeNonBlocking = async (command, options) => {
      executeCalls.push({ command, options });
      return '%1';
    };
    try {
      await executeNonBlocking.getCurrentPaneId('/Users/vera/raw-caller');
    } finally {
      executeNonBlocking.executeNonBlocking = originalExecuteNonBlocking;
    }

    expect(executeCalls).toEqual([
      expect.objectContaining({
        command: 'tmux display-message -p "#{pane_id}"',
        options: expect.objectContaining({
          metadata: { currentPaneContext: 'unknown' },
        }),
      }),
    ]);
  });
});
