import { afterEach, describe, expect, it, vi } from 'vitest';
import { TmuxService } from '../src/services/TmuxService.js';

describe('TmuxService detach helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the most recently active client tty when tmux reports one', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockImplementation(
      (command: string) => {
        if (command === 'tmux list-clients -F "#{client_activity}\t#{client_tty}"') {
          return '100\t/dev/ttys001\n250\t/dev/ttys002';
        }
        throw new Error(`Unexpected command: ${command}`);
      }
    );

    await expect(service.getCurrentClientTty()).resolves.toBe('/dev/ttys002');
    expect(executeSpy).toHaveBeenCalledWith(
      'tmux list-clients -F "#{client_activity}\t#{client_tty}"'
    );
  });

  it('falls back to display-message when client list lookup is empty', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockImplementation(
      (command: string) => {
        if (command === 'tmux list-clients -F "#{client_activity}\t#{client_tty}"') {
          return '   ';
        }
        if (command === 'tmux display-message -p "#{client_tty}"') {
          return '/dev/ttys001';
        }
        throw new Error(`Unexpected command: ${command}`);
      }
    );

    await expect(service.getCurrentClientTty()).resolves.toBe('/dev/ttys001');
    expect(executeSpy).toHaveBeenCalledWith(
      'tmux display-message -p "#{client_tty}"'
    );
  });

  it('returns null when tmux reports no client tty', async () => {
    const service = TmuxService.getInstance();
    vi.spyOn(service as any, 'execute').mockImplementation((command: string) => {
      if (command === 'tmux list-clients -F "#{client_activity}\t#{client_tty}"') {
        return '   ';
      }
      if (command === 'tmux display-message -p "#{client_tty}"') {
        return '   ';
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(service.getCurrentClientTty()).resolves.toBeNull();
  });

  it('detaches a specific client tty', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi
      .spyOn(service as any, 'execute')
      .mockReturnValue('');

    await service.detachClient('/dev/ttys001');

    expect(executeSpy).toHaveBeenCalledWith(
      "tmux detach-client -t '/dev/ttys001'"
    );
  });

  it('detaches the resolved current client tty', async () => {
    const service = TmuxService.getInstance();
    const getCurrentClientTtySpy = vi
      .spyOn(service, 'getCurrentClientTty')
      .mockResolvedValue('/dev/ttys001');
    const detachClientSpy = vi
      .spyOn(service, 'detachClient')
      .mockResolvedValue();

    await service.detachCurrentClient();

    expect(getCurrentClientTtySpy).toHaveBeenCalledTimes(1);
    expect(detachClientSpy).toHaveBeenCalledWith('/dev/ttys001');
  });

  it('throws when no current client tty can be resolved', async () => {
    const service = TmuxService.getInstance();
    vi.spyOn(service, 'getCurrentClientTty').mockResolvedValue(null);
    const detachClientSpy = vi
      .spyOn(service, 'detachClient')
      .mockResolvedValue();

    await expect(service.detachCurrentClient()).rejects.toThrow(
      'No active tmux client could be resolved for detach'
    );
    expect(detachClientSpy).not.toHaveBeenCalled();
  });
});
