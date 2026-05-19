import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseTmuxHookPayloadLine,
  type TmuxHookSignalEvent,
  TmuxHookManager,
} from '../src/services/TmuxHookManager.js';

const execAsyncMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/execAsync.js', () => ({
  execAsync: execAsyncMock,
}));

const currentPid = process.pid;

function managerForSession(sessionName = 'dmux-test'): TmuxHookManager {
  const manager = TmuxHookManager.getInstance();
  manager.initialize(sessionName);
  return manager;
}

function showHooksOutput(pid: number): string {
  return [
    `after-split-window[0] run-shell "kill -USR2 ${pid} 2>/dev/null || true # dmux-hook:v2"`,
    `after-kill-pane[0] run-shell "DMUX_RECOVERY_SESSION_B64=ZG11eC10ZXN0 kill -USR2 ${pid} 2>/dev/null || true # dmux-hook:v2"`,
    `client-resized[0] run-shell "kill -USR2 ${pid} 2>/dev/null || true # dmux-hook:v2"`,
    `after-select-pane[0] run-shell -b "kill -USR2 ${pid} 2>/dev/null || true # dmux-hook:v2"`,
  ].join('\n');
}

async function collectHookEvents(
  manager: TmuxHookManager,
  trigger: () => void
): Promise<TmuxHookSignalEvent[]> {
  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for hook events'));
    }, 250);
    unsubscribe = manager.onHookTriggered((events) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(events);
    }, 0);
    trigger();
  });
}

describe('TmuxHookManager', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execAsyncMock.mockReset();
    killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number | NodeJS.Signals) => {
      if (pid === currentPid) {
        return true;
      }

      const error = new Error('No such process') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }) as typeof process.kill);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('rejects stale dmux hooks that target a different process', async () => {
    execAsyncMock.mockResolvedValue(showHooksOutput(currentPid + 1000));

    await expect(managerForSession().areHooksInstalled()).resolves.toBe(false);
  });

  it('accepts dmux hooks that target the current process', async () => {
    execAsyncMock.mockResolvedValue(showHooksOutput(currentPid));

    await expect(managerForSession().areHooksInstalled()).resolves.toBe(true);
  });

  it('rejects legacy current-process hooks so install can replace them with v2 hooks', async () => {
    execAsyncMock.mockResolvedValue([
      `after-split-window[0] run-shell "kill -USR2 ${currentPid} 2>/dev/null || true # dmux-hook"`,
      `after-kill-pane[0] run-shell "kill -USR2 ${currentPid} 2>/dev/null || true # dmux-hook"`,
      `client-resized[0] run-shell "kill -USR2 ${currentPid} 2>/dev/null || true # dmux-hook"`,
      `after-select-pane[0] run-shell -b "kill -USR2 ${currentPid} 2>/dev/null || true # dmux-hook"`,
    ].join('\n'));

    await expect(managerForSession().areHooksInstalled()).resolves.toBe(false);
  });

  it('appends missing current-process hooks without replacing unrelated tmux hooks', async () => {
    const existingHooks = [
      'after-select-pane[0] run-shell "echo user-hook"',
      `after-select-pane[1] run-shell -b "kill -USR2 ${currentPid + 1000} 2>/dev/null || true # dmux-hook"`,
      'after-kill-pane[0] run-shell "echo keep-me"',
    ].join('\n');
    execAsyncMock.mockResolvedValueOnce(existingHooks).mockResolvedValue('');

    await expect(managerForSession().installHooks()).resolves.toBe(true);

    const commands = execAsyncMock.mock.calls.map((call) => String(call[0]));
    expect(commands).toContain("tmux show-hooks -t 'dmux-test' 2>/dev/null");
    expect(commands).toContain("tmux set-hook -u -t 'dmux-test' 'after-select-pane[1]'");
    expect(commands).not.toContain("tmux set-hook -u -t 'dmux-test' after-select-pane");
    expect(commands).not.toContain("tmux set-hook -u -t 'dmux-test' after-kill-pane");
    expect(commands.filter((command) => command.includes('tmux set-hook -a'))).toHaveLength(4);
    expect(commands.filter((command) => command.includes('# dmux-hook:v2'))).toHaveLength(4);
  });

  it('replaces legacy current-process hooks during install', async () => {
    const existingHooks = [
      `after-select-pane[0] run-shell -b "kill -USR2 ${currentPid} 2>/dev/null || true # dmux-hook"`,
    ].join('\n');
    execAsyncMock.mockResolvedValueOnce(existingHooks).mockResolvedValue('');

    await expect(managerForSession().installHooks()).resolves.toBe(true);

    const commands = execAsyncMock.mock.calls.map((call) => String(call[0]));
    expect(commands).toContain("tmux set-hook -u -t 'dmux-test' 'after-select-pane[0]'");
    expect(commands.filter((command) => command.includes('tmux set-hook -a'))).toHaveLength(4);
    expect(commands.filter((command) => command.includes('tmuxHookPayloadWriter.js'))).toHaveLength(4);
  });

  it('uninstalls only dmux-owned hook entries and preserves unrelated hooks', async () => {
    const existingHooks = [
      'after-select-pane[0] run-shell "echo user-hook"',
      `after-select-pane[1] run-shell -b "kill -USR2 ${currentPid} 2>/dev/null || true # dmux-hook"`,
      `client-resized[0] run-shell "kill -USR2 ${currentPid + 1000} 2>/dev/null || true # dmux-hook"`,
    ].join('\n');
    execAsyncMock.mockResolvedValueOnce(existingHooks).mockResolvedValue('');

    await expect(managerForSession().uninstallHooks()).resolves.toBe(true);

    const commands = execAsyncMock.mock.calls.map((call) => String(call[0]));
    expect(commands).toContain("tmux set-hook -u -t 'dmux-test' 'after-select-pane[1]'");
    expect(commands).toContain("tmux set-hook -u -t 'dmux-test' 'client-resized[0]'");
    expect(commands).not.toContain("tmux set-hook -u -t 'dmux-test' after-select-pane");
    expect(commands).not.toContain("tmux set-hook -u -t 'dmux-test' client-resized");
  });

  it('preserves live foreign dmux hooks while replacing dead stale hooks', async () => {
    const liveForeignPid = currentPid + 2000;
    const deadForeignPid = currentPid + 3000;
    killSpy.mockImplementation(((pid: number | NodeJS.Signals) => {
      if (pid === currentPid || pid === liveForeignPid) {
        return true;
      }

      const error = new Error('No such process') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }) as typeof process.kill);

    const existingHooks = [
      `after-select-pane[1] run-shell -b "kill -USR2 ${liveForeignPid} 2>/dev/null || true # dmux-hook"`,
      `after-select-pane[2] run-shell -b "kill -USR2 ${deadForeignPid} 2>/dev/null || true # dmux-hook"`,
    ].join('\n');
    execAsyncMock.mockResolvedValueOnce(existingHooks).mockResolvedValue('');

    await expect(managerForSession().installHooks()).resolves.toBe(true);

    const commands = execAsyncMock.mock.calls.map((call) => String(call[0]));
    expect(commands).not.toContain("tmux set-hook -u -t 'dmux-test' 'after-select-pane[1]'");
    expect(commands).toContain("tmux set-hook -u -t 'dmux-test' 'after-select-pane[2]'");
  });

  it('preserves live foreign dmux hooks during uninstall', async () => {
    const liveForeignPid = currentPid + 4000;
    killSpy.mockImplementation(((pid: number | NodeJS.Signals) => {
      if (pid === currentPid || pid === liveForeignPid) {
        return true;
      }

      const error = new Error('No such process') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }) as typeof process.kill);

    const existingHooks = [
      `after-select-pane[1] run-shell -b "kill -USR2 ${liveForeignPid} 2>/dev/null || true # dmux-hook"`,
      `after-select-pane[2] run-shell -b "kill -USR2 ${currentPid} 2>/dev/null || true # dmux-hook"`,
    ].join('\n');
    execAsyncMock.mockResolvedValueOnce(existingHooks).mockResolvedValue('');

    await expect(managerForSession().uninstallHooks()).resolves.toBe(true);

    const commands = execAsyncMock.mock.calls.map((call) => String(call[0]));
    expect(commands).not.toContain("tmux set-hook -u -t 'dmux-test' 'after-select-pane[1]'");
    expect(commands).toContain("tmux set-hook -u -t 'dmux-test' 'after-select-pane[2]'");
  });

  it('parses valid hook payloads for the current process and session', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      eventType: 'pane-focus-changed',
      timestamp: 123,
      pid: currentPid,
      sessionName: 'dmux-test',
      activePaneId: '%7',
    });

    expect(parseTmuxHookPayloadLine(line, {
      pid: currentPid,
      sessionName: 'dmux-test',
    })).toMatchObject({
      eventType: 'pane-focus-changed',
      activePaneId: '%7',
    });
  });

  it('rejects malformed or foreign hook payloads', () => {
    expect(parseTmuxHookPayloadLine('{nope', {
      pid: currentPid,
      sessionName: 'dmux-test',
    })).toBeNull();
    expect(parseTmuxHookPayloadLine(JSON.stringify({
      schemaVersion: 1,
      eventType: 'pane-focus-changed',
      timestamp: 123,
      pid: currentPid + 1,
      sessionName: 'dmux-test',
      activePaneId: '%7',
    }), {
      pid: currentPid,
      sessionName: 'dmux-test',
    })).toBeNull();
    expect(parseTmuxHookPayloadLine(JSON.stringify({
      schemaVersion: 1,
      eventType: 'pane-focus-changed',
      timestamp: 123,
      pid: currentPid,
      sessionName: 'dmux-test',
    }), {
      pid: currentPid,
      sessionName: 'dmux-test',
    })).toBeNull();
  });

  it('drains hook payload JSONL by byte offset and leaves partial trailing lines for later', async () => {
    const manager = managerForSession('dmux-drain-test');
    const eventLogPath = manager.getHookEventLogPath();
    expect(eventLogPath).not.toBeNull();
    if (!eventLogPath) {
      return;
    }

    const firstPayload = JSON.stringify({
      schemaVersion: 1,
      eventType: 'pane-focus-changed',
      timestamp: 123,
      pid: currentPid,
      sessionName: 'dmux-drain-test',
      activePaneId: '%1',
    });
    const secondPayload = JSON.stringify({
      schemaVersion: 1,
      eventType: 'pane-focus-changed',
      timestamp: 456,
      pid: currentPid,
      sessionName: 'dmux-drain-test',
      activePaneId: '%2',
    });
    const splitIndex = Math.floor(secondPayload.length / 2);
    fs.writeFileSync(
      eventLogPath,
      `${firstPayload}\n${secondPayload.slice(0, splitIndex)}`,
      'utf-8'
    );

    const firstEvents = await collectHookEvents(manager, () => {
      process.emit('SIGUSR2' as NodeJS.Signals);
    });
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0]).toMatchObject({
      type: 'payload',
      payload: {
        eventType: 'pane-focus-changed',
        activePaneId: '%1',
      },
    });

    fs.appendFileSync(eventLogPath, `${secondPayload.slice(splitIndex)}\n`, 'utf-8');
    const secondEvents = await collectHookEvents(manager, () => {
      process.emit('SIGUSR2' as NodeJS.Signals);
    });
    expect(secondEvents).toHaveLength(1);
    expect(secondEvents[0]).toMatchObject({
      type: 'payload',
      payload: {
        eventType: 'pane-focus-changed',
        activePaneId: '%2',
      },
    });
  });
});
