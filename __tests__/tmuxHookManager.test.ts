import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TmuxHookManager } from '../src/services/TmuxHookManager.js';

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
    `after-split-window[0] run-shell "kill -USR2 ${pid} 2>/dev/null || true # dmux-hook"`,
    `after-kill-pane[0] run-shell "DMUX_RECOVERY_SESSION_B64=ZG11eC10ZXN0 kill -USR2 ${pid} 2>/dev/null || true # dmux-hook"`,
    `client-resized[0] run-shell "kill -USR2 ${pid} 2>/dev/null || true # dmux-hook"`,
    `after-select-pane[0] run-shell -b "kill -USR2 ${pid} 2>/dev/null || true # dmux-hook"`,
  ].join('\n');
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
});
