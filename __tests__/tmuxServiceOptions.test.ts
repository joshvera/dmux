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

  it('records bounded pane option kinds at the service boundary', () => {
    const service = TmuxService.getInstance();
    const executeCalls: Array<{
      command: string;
      options: { operation?: string; metadata?: Record<string, unknown> };
    }> = [];
    const serviceWithPrivateExecute = service as unknown as {
      execute: (
        command: string,
        options: { operation?: string; metadata?: Record<string, unknown> }
      ) => string;
      setPaneOptionSync: (paneId: string, option: string, value: string) => void;
      unsetPaneOptionSync: (paneId: string, option: string) => void;
    };
    const originalExecute = serviceWithPrivateExecute.execute;

    serviceWithPrivateExecute.execute = (command, options) => {
      executeCalls.push({ command, options });
      return '';
    };
    try {
      serviceWithPrivateExecute.setPaneOptionSync('%1', '@dmux_title_prefix', '/Users/vera/raw-value');
      serviceWithPrivateExecute.unsetPaneOptionSync('%1', 'window-style');
      serviceWithPrivateExecute.setPaneOptionSync('%1', '@dmux_welcome_theme', 'cyan');
      serviceWithPrivateExecute.setPaneOptionSync('%1', '/Users/vera/raw-option', 'value');
    } finally {
      serviceWithPrivateExecute.execute = originalExecute;
    }

    expect(executeCalls.map((call) => call.options)).toEqual([
      expect.objectContaining({
        operation: 'tmux-option',
        metadata: { paneOptionKind: 'dmux-title-prefix' },
      }),
      expect.objectContaining({
        operation: 'tmux-option',
        metadata: { paneOptionKind: 'window-style' },
      }),
      expect.objectContaining({
        operation: 'tmux-option',
        metadata: { paneOptionKind: 'dmux-welcome-theme' },
      }),
      expect.objectContaining({
        operation: 'tmux-option',
        metadata: { paneOptionKind: 'other' },
      }),
    ]);
    expect(JSON.stringify(executeCalls.map((call) => call.options))).not.toContain('/Users/vera');
  });
});
