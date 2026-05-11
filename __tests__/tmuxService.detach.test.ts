import { afterEach, describe, expect, it, vi } from 'vitest';
import { TmuxService } from '../src/services/TmuxService.js';

describe('TmuxService detach helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the contextual client tty when tmux reports one', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockImplementation(
      (command: string) => {
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

  it('falls back to the most recently active client tty when contextual lookup is empty', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockImplementation(
      (command: string) => {
        if (command === 'tmux display-message -p "#{client_tty}"') {
          return '   ';
        }
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

  it('returns null when tmux reports no client tty', async () => {
    const service = TmuxService.getInstance();
    vi.spyOn(service as any, 'execute').mockImplementation((command: string) => {
      if (command === 'tmux display-message -p "#{client_tty}"') {
        return '   ';
      }
      if (command === 'tmux list-clients -F "#{client_activity}\t#{client_tty}"') {
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

  it('normalizes a specific client key table back to root', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockImplementation(
      (command: string) => {
        if (command === 'tmux list-clients -F "#{client_tty}\t#{client_key_table}"') {
          return '/dev/ttys001\tprefix';
        }
        if (command === "tmux switch-client -c '/dev/ttys001' -T root") {
          return '';
        }
        throw new Error(`Unexpected command: ${command}`);
      }
    );

    await expect(
      service.normalizeClientKeyTableToRoot('/dev/ttys001')
    ).resolves.toBe(true);

    expect(executeSpy).toHaveBeenCalledWith(
      "tmux switch-client -c '/dev/ttys001' -T root"
    );
  });

  it('leaves intentional non-prefix client key tables alone', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockImplementation(
      (command: string) => {
        if (command === 'tmux list-clients -F "#{client_tty}\t#{client_key_table}"') {
          return '/dev/ttys001\tdmux-detach-confirm';
        }
        throw new Error(`Unexpected command: ${command}`);
      }
    );

    await expect(
      service.normalizeClientKeyTableToRoot('/dev/ttys001')
    ).resolves.toBe(false);

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('no-ops key table normalization when no client can be resolved', async () => {
    const service = TmuxService.getInstance();
    const getCurrentClientTtySpy = vi
      .spyOn(service, 'getCurrentClientTty')
      .mockResolvedValue(null);
    const executeSpy = vi.spyOn(service as any, 'execute').mockReturnValue('');

    await expect(service.normalizeClientKeyTableToRoot()).resolves.toBe(false);

    expect(getCurrentClientTtySpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('does not throw when key table normalization fails', async () => {
    const service = TmuxService.getInstance();
    vi.spyOn(service as any, 'execute').mockImplementation((command: string) => {
      if (command === 'tmux list-clients -F "#{client_tty}\t#{client_key_table}"') {
        return '/dev/ttys001\tprefix';
      }
      throw new Error('switch failed');
    });

    await expect(
      service.normalizeClientKeyTableToRoot('/dev/ttys001')
    ).resolves.toBe(false);
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

  it('enters the tmux detach confirmation key table and shows guidance', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockReturnValue('');
    const getCurrentClientTtySpy = vi
      .spyOn(service, 'getCurrentClientTty')
      .mockResolvedValue('/dev/ttys001');

    await service.enterDetachConfirmMode();

    expect(getCurrentClientTtySpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenNthCalledWith(
      1,
      "tmux switch-client -c '/dev/ttys001' -T 'dmux-detach-confirm'"
    );
    expect(executeSpy).toHaveBeenNthCalledWith(
      2,
      "tmux display-message -d 3000 'Press q or Ctrl+C again to detach. Esc cancels.'"
    );
  });

  it('falls back to tmux current-client context for detach confirmation when no client resolves', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi.spyOn(service as any, 'execute').mockReturnValue('');
    vi.spyOn(service, 'getCurrentClientTty').mockResolvedValue(null);

    await service.enterDetachConfirmMode();

    expect(executeSpy).toHaveBeenNthCalledWith(
      1,
      "tmux switch-client -T 'dmux-detach-confirm'"
    );
  });
});
