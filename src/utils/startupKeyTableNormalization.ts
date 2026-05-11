import { LogService } from '../services/LogService.js';
import { TmuxService } from '../services/TmuxService.js';

export interface StartupKeyTableNormalizationOptions {
  enabled?: boolean;
  schedule?: (callback: () => void) => void;
  normalize?: () => unknown | Promise<unknown>;
  logDebug?: (message: string, source?: string) => void;
}

const LOG_SOURCE = 'tmux';

function formatNormalizationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function scheduleStartupKeyTableNormalization(
  options: StartupKeyTableNormalizationOptions = {}
): void {
  const enabled = options.enabled ?? Boolean(process.env.TMUX);
  if (!enabled) {
    return;
  }

  const schedule = options.schedule ?? ((callback: () => void) => setImmediate(callback));
  const normalize = options.normalize
    ?? (() => TmuxService.getInstance().normalizeClientKeyTableToRoot());
  const logDebug = options.logDebug
    ?? ((message: string, source?: string) => LogService.getInstance().debug(message, source));

  const logFailure = (error: unknown) => {
    logDebug(
      `Startup key table normalization failed: ${formatNormalizationError(error)}`,
      LOG_SOURCE
    );
  };

  schedule(() => {
    try {
      void Promise.resolve(normalize()).catch(logFailure);
    } catch (error) {
      logFailure(error);
    }
  });
}
