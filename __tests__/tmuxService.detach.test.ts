import { describe, expect, it } from 'vitest';
import { TmuxService } from '../src/services/TmuxService.js';

type CommandResponse = string | Error;

function createService(responses: Record<string, CommandResponse>) {
  const commands: string[] = [];
  const service = new TmuxService((command: string) => {
    commands.push(command);
    if (!Object.prototype.hasOwnProperty.call(responses, command)) {
      throw new Error(`Unexpected command: ${command}`);
    }

    const response = responses[command];
    if (response instanceof Error) {
      throw response;
    }

    return response;
  });

  return { commands, service };
}

const CURRENT_CLIENT_COMMAND = 'tmux display-message -p "#{client_tty}"';
const CLIENT_ACTIVITY_COMMAND =
  'tmux list-clients -F "#{client_activity}\t#{client_tty}"';
const CLIENT_KEY_TABLE_COMMAND =
  'tmux list-clients -F "#{client_tty}\t#{client_key_table}"';
const DETACH_GUIDANCE_COMMAND =
  "tmux display-message -d 3000 'Press q or Ctrl+C again to detach. Esc cancels.'";

describe('TmuxService detach helpers', () => {
  it('returns the contextual client tty when tmux reports one', async () => {
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '/dev/ttys001',
    });

    await expect(service.getCurrentClientTty()).resolves.toBe('/dev/ttys001');
    expect(commands).toEqual([CURRENT_CLIENT_COMMAND]);
  });

  it('falls back to the most recently active client tty when contextual lookup is empty', async () => {
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '   ',
      [CLIENT_ACTIVITY_COMMAND]: '100\t/dev/ttys001\n250\t/dev/ttys002',
    });

    await expect(service.getCurrentClientTty()).resolves.toBe('/dev/ttys002');
    expect(commands).toEqual([
      CURRENT_CLIENT_COMMAND,
      CLIENT_ACTIVITY_COMMAND,
    ]);
  });

  it('returns null when tmux reports no client tty', async () => {
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '   ',
      [CLIENT_ACTIVITY_COMMAND]: '   ',
    });

    await expect(service.getCurrentClientTty()).resolves.toBeNull();
    expect(commands).toEqual([
      CURRENT_CLIENT_COMMAND,
      CLIENT_ACTIVITY_COMMAND,
    ]);
  });

  it('detaches a specific client tty', async () => {
    const detachCommand = "tmux detach-client -t '/dev/ttys001'";
    const { commands, service } = createService({
      [detachCommand]: '',
    });

    await service.detachClient('/dev/ttys001');

    expect(commands).toEqual([detachCommand]);
  });

  it('normalizes a specific client key table back to root', async () => {
    const switchCommand = "tmux switch-client -c '/dev/ttys001' -T root";
    const { commands, service } = createService({
      [CLIENT_KEY_TABLE_COMMAND]: '/dev/ttys001\tprefix',
      [switchCommand]: '',
    });

    await expect(
      service.normalizeClientKeyTableToRoot('/dev/ttys001')
    ).resolves.toBe(true);

    expect(commands).toEqual([CLIENT_KEY_TABLE_COMMAND, switchCommand]);
  });

  it('leaves intentional non-prefix client key tables alone', async () => {
    const { commands, service } = createService({
      [CLIENT_KEY_TABLE_COMMAND]: '/dev/ttys001\tdmux-detach-confirm',
    });

    await expect(
      service.normalizeClientKeyTableToRoot('/dev/ttys001')
    ).resolves.toBe(false);

    expect(commands).toEqual([CLIENT_KEY_TABLE_COMMAND]);
  });

  it('no-ops key table normalization when no client can be resolved', async () => {
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '   ',
      [CLIENT_ACTIVITY_COMMAND]: '   ',
    });

    await expect(service.normalizeClientKeyTableToRoot()).resolves.toBe(false);

    expect(commands).toEqual([
      CURRENT_CLIENT_COMMAND,
      CLIENT_ACTIVITY_COMMAND,
    ]);
  });

  it('does not throw when key table normalization fails', async () => {
    const switchCommand = "tmux switch-client -c '/dev/ttys001' -T root";
    const { commands, service } = createService({
      [CLIENT_KEY_TABLE_COMMAND]: '/dev/ttys001\tprefix',
      [switchCommand]: new Error("can't find pane"),
    });

    await expect(
      service.normalizeClientKeyTableToRoot('/dev/ttys001')
    ).resolves.toBe(false);

    expect(commands).toEqual([CLIENT_KEY_TABLE_COMMAND, switchCommand]);
  });

  it('detaches the resolved current client tty', async () => {
    const detachCommand = "tmux detach-client -t '/dev/ttys001'";
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '/dev/ttys001',
      [detachCommand]: '',
    });

    await service.detachCurrentClient();

    expect(commands).toEqual([CURRENT_CLIENT_COMMAND, detachCommand]);
  });

  it('throws when no current client tty can be resolved', async () => {
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '   ',
      [CLIENT_ACTIVITY_COMMAND]: '   ',
    });

    await expect(service.detachCurrentClient()).rejects.toThrow(
      'No active tmux client could be resolved for detach'
    );
    expect(commands).toEqual([
      CURRENT_CLIENT_COMMAND,
      CLIENT_ACTIVITY_COMMAND,
    ]);
  });

  it('enters the tmux detach confirmation key table and shows guidance', async () => {
    const switchCommand =
      "tmux switch-client -c '/dev/ttys001' -T 'dmux-detach-confirm'";
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '/dev/ttys001',
      [switchCommand]: '',
      [DETACH_GUIDANCE_COMMAND]: '',
    });

    await service.enterDetachConfirmMode();

    expect(commands).toEqual([
      CURRENT_CLIENT_COMMAND,
      switchCommand,
      DETACH_GUIDANCE_COMMAND,
    ]);
  });

  it('falls back to tmux current-client context for detach confirmation when no client resolves', async () => {
    const switchCommand = "tmux switch-client -T 'dmux-detach-confirm'";
    const { commands, service } = createService({
      [CURRENT_CLIENT_COMMAND]: '   ',
      [CLIENT_ACTIVITY_COMMAND]: '   ',
      [switchCommand]: '',
      [DETACH_GUIDANCE_COMMAND]: '',
    });

    await service.enterDetachConfirmMode();

    expect(commands).toEqual([
      CURRENT_CLIENT_COMMAND,
      CLIENT_ACTIVITY_COMMAND,
      switchCommand,
      DETACH_GUIDANCE_COMMAND,
    ]);
  });
});
