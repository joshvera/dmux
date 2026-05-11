import { afterEach, describe, expect, it, vi } from 'vitest';
import { TmuxService } from '../src/services/TmuxService.js';
import { shellQuote } from '../src/utils/shellQuote.js';

describe('TmuxService sendShellCommandAndEnter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the shell command and Enter in one tmux invocation', async () => {
    const service = TmuxService.getInstance();
    const executeSpy = vi
      .spyOn(service as any, 'execute')
      .mockReturnValue('');
    const command = `printf '%s\\n' ${shellQuote(`# Original prompt: it's quoted...`)}`;

    await service.sendShellCommandAndEnter('%1', command);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(
      `tmux send-keys -t '%1' ${shellQuote(command)} Enter`
    );
  });
});
