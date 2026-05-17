/**
 * TmuxHookManager - Manages tmux hooks for event-driven updates
 *
 * Instead of polling every 5 seconds, tmux hooks notify dmux immediately
 * when panes are created, closed, or resized. This reduces CPU usage and
 * improves responsiveness.
 *
 * Hooks are optional - users can decline and fall back to polling.
 */

import { EventEmitter } from 'events';
import { execAsync } from '../utils/execAsync.js';
import {
  buildPaneExitedHookCommandForSession,
  buildPaneFocusHookCommandForSession,
} from '../utils/tmuxHookCommands.js';
import { LogService } from './LogService.js';

export type HookEvent = 'pane-created' | 'pane-closed' | 'pane-resized' | 'pane-focus-changed';

export interface HookStatus {
  installed: boolean;
  hooks: {
    afterSplitWindow: boolean;
    paneExited: boolean;
    clientResized: boolean;
    afterSelectPane: boolean;
  };
}

interface TmuxHookEntry {
  hookName: keyof typeof HOOK_CONFIG;
  index: number | null;
  target: string;
  command: string;
}

/**
 * Hook configuration - maps tmux hook names to our events
 */
const HOOK_CONFIG = {
  'after-split-window': 'pane-created',
  'after-kill-pane': 'pane-closed',
  'client-resized': 'pane-resized',
  'after-select-pane': 'pane-focus-changed',
} as const;

const MANAGED_HOOK_NAMES = Object.keys(HOOK_CONFIG) as Array<keyof typeof HOOK_CONFIG>;
const DMUX_HOOK_MARKER = '# dmux-hook';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * TmuxHookManager singleton
 *
 * Manages the lifecycle of tmux hooks and emits events when they fire.
 * Uses Unix signals (SIGUSR2) to receive hook notifications.
 */
export class TmuxHookManager extends EventEmitter {
  private static instance: TmuxHookManager;
  private logger = LogService.getInstance();
  private sessionName: string = '';
  private pid: number = process.pid;
  private hooksInstalled = false;
  private signalHandlerSetup = false;

  private constructor() {
    super();
  }

  static getInstance(): TmuxHookManager {
    if (!TmuxHookManager.instance) {
      TmuxHookManager.instance = new TmuxHookManager();
    }
    return TmuxHookManager.instance;
  }

  /**
   * Initialize the hook manager with the current session
   */
  initialize(sessionName: string): void {
    this.sessionName = sessionName;
    this.setupSignalHandler();
  }

  /**
   * Set up the SIGUSR2 signal handler to receive hook notifications
   */
  private setupSignalHandler(): void {
    if (this.signalHandlerSetup) return;

    process.on('SIGUSR2', () => {
      this.logger.debug('Received SIGUSR2 signal from tmux hook', 'hooks');
      // Emit a generic event - the listener will need to check what changed
      this.emit('hook-triggered');
    });

    this.signalHandlerSetup = true;
    this.logger.debug('SIGUSR2 signal handler set up for tmux hooks', 'hooks');
  }

  /**
   * Check which hooks are currently installed for this session
   */
  async checkHookStatus(): Promise<HookStatus> {
    if (!this.sessionName) {
      return {
        installed: false,
        hooks: {
          afterSplitWindow: false,
          paneExited: false,
          clientResized: false,
          afterSelectPane: false,
        },
      };
    }

    const hooks = {
      afterSplitWindow: false,
      paneExited: false,
      clientResized: false,
      afterSelectPane: false,
    };

    try {
      const entries = await this.readHookEntries();

      hooks.afterSplitWindow = this.hasCurrentDmuxHook(entries, 'after-split-window');
      hooks.paneExited = this.hasCurrentDmuxHook(entries, 'after-kill-pane');
      hooks.clientResized = this.hasCurrentDmuxHook(entries, 'client-resized');
      hooks.afterSelectPane = this.hasCurrentDmuxHook(entries, 'after-select-pane');

      const installed = hooks.afterSplitWindow
        && hooks.paneExited
        && hooks.clientResized
        && hooks.afterSelectPane;

      return { installed, hooks };
    } catch (error) {
      this.logger.debug(`Failed to check hook status: ${error}`, 'hooks');
      return { installed: false, hooks };
    }
  }

  /**
   * Quick check if hooks appear to be installed (fast, for startup)
   */
  async areHooksInstalled(): Promise<boolean> {
    if (!this.sessionName) return false;

    try {
      const entries = await this.readHookEntries(1000);
      return MANAGED_HOOK_NAMES.every((hookName) =>
        this.hasCurrentDmuxHook(entries, hookName)
      );
    } catch {
      return false;
    }
  }

  /**
   * Install all performance hooks for this session
   */
  async installHooks(): Promise<boolean> {
    if (!this.sessionName) {
      this.logger.error('Cannot install hooks: session name not set', 'hooks');
      return false;
    }

    try {
      const existingEntries = await this.readHookEntries();
      const staleDmuxEntries = existingEntries.filter((entry) =>
        this.isStaleDmuxHook(entry)
      );

      for (const entry of staleDmuxEntries) {
        await execAsync(
          `tmux set-hook -u -t ${shellQuote(this.sessionName)} ${shellQuote(entry.target)}`,
          { timeout: 2000 }
        );
      }

      // Create hook commands that send SIGUSR2 to this process
      // We add a comment marker so we can identify our hooks later
      const paneExitedHookCommand = buildPaneExitedHookCommandForSession(
        this.pid,
        this.sessionName
      );
      const paneFocusHookCommand = buildPaneFocusHookCommandForSession(
        this.sessionName,
        this.pid
      );
      const hookCommands: Array<{ hookName: keyof typeof HOOK_CONFIG; command: string }> = [
        // Pane split (new pane created)
        {
          hookName: 'after-split-window',
          command: `run-shell "kill -USR2 ${this.pid} 2>/dev/null || true # dmux-hook"`,
        },
        // Pane closed (includes control-pane recovery if needed)
        {
          hookName: 'after-kill-pane',
          command: paneExitedHookCommand,
        },
        // Window/client resized
        {
          hookName: 'client-resized',
          command: `run-shell "kill -USR2 ${this.pid} 2>/dev/null || true # dmux-hook"`,
        },
        // Pane focus changed
        {
          hookName: 'after-select-pane',
          command: paneFocusHookCommand,
        },
      ];

      for (const hookCommand of hookCommands) {
        if (this.hasCurrentDmuxHook(existingEntries, hookCommand.hookName)) {
          continue;
        }

        await execAsync(
          `tmux set-hook -a -t ${shellQuote(this.sessionName)} ${hookCommand.hookName} ${shellQuote(hookCommand.command)}`,
          { timeout: 2000 }
        );
      }

      this.hooksInstalled = true;
      this.logger.info('Tmux hooks installed successfully', 'hooks');
      return true;
    } catch (error) {
      this.logger.error(`Failed to install hooks: ${error}`, 'hooks');
      return false;
    }
  }

  /**
   * Remove all dmux hooks from this session
   */
  async uninstallHooks(): Promise<boolean> {
    if (!this.sessionName) return false;

    try {
      const removableDmuxEntries = (await this.readHookEntries()).filter((entry) =>
        this.isCurrentDmuxHook(entry) || this.isStaleDmuxHook(entry)
      );

      // Try to unset each hook (ignore errors - hook might not exist)
      await Promise.all(
        removableDmuxEntries.map((entry) =>
          execAsync(
            `tmux set-hook -u -t ${shellQuote(this.sessionName)} ${shellQuote(entry.target)}`,
            { silent: true, timeout: 2000 }
          ).catch(() => {})
        )
      );

      this.hooksInstalled = false;
      this.logger.info('Tmux hooks uninstalled', 'hooks');
      return true;
    } catch (error) {
      this.logger.debug(`Error uninstalling hooks: ${error}`, 'hooks');
      return false;
    }
  }

  /**
   * Check if hooks are currently active
   */
  isActive(): boolean {
    return this.hooksInstalled;
  }

  private async readHookEntries(timeout = 2000): Promise<TmuxHookEntry[]> {
    const output = await execAsync(
      `tmux show-hooks -t ${shellQuote(this.sessionName)} 2>/dev/null`,
      { silent: true, timeout }
    );

    return output
      .split('\n')
      .map((line) => this.parseHookEntry(line))
      .filter((entry): entry is TmuxHookEntry => entry !== null);
  }

  private parseHookEntry(line: string): TmuxHookEntry | null {
    const match = line.match(/^([a-z-]+)(?:\[(\d+)])?\s+(.+)$/);
    if (!match) {
      return null;
    }

    const hookName = match[1];
    if (!this.isManagedHookName(hookName)) {
      return null;
    }

    const index = match[2] === undefined ? null : Number(match[2]);
    const target = index === null ? hookName : `${hookName}[${index}]`;

    return {
      hookName,
      index,
      target,
      command: match[3],
    };
  }

  private isManagedHookName(hookName: string): hookName is keyof typeof HOOK_CONFIG {
    return MANAGED_HOOK_NAMES.includes(hookName as keyof typeof HOOK_CONFIG);
  }

  private isDmuxHook(command: string): boolean {
    return command.includes(DMUX_HOOK_MARKER);
  }

  private extractDmuxHookPid(command: string): number | null {
    if (!this.isDmuxHook(command)) {
      return null;
    }

    const match = command.match(/\bkill\s+-USR2\s+(\d+)\b/);
    if (!match) {
      return null;
    }

    return Number(match[1]);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return this.isPermissionError(error);
    }
  }

  private isPermissionError(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'EPERM';
  }

  private isCurrentDmuxHook(entry: TmuxHookEntry): boolean {
    const hookPid = this.extractDmuxHookPid(entry.command);
    return hookPid === this.pid && this.isProcessAlive(hookPid);
  }

  private isStaleDmuxHook(entry: TmuxHookEntry): boolean {
    const hookPid = this.extractDmuxHookPid(entry.command);
    return hookPid !== null && hookPid !== this.pid && !this.isProcessAlive(hookPid);
  }

  private hasCurrentDmuxHook(
    entries: TmuxHookEntry[],
    hookName: keyof typeof HOOK_CONFIG
  ): boolean {
    return entries.some((entry) =>
      entry.hookName === hookName && this.isCurrentDmuxHook(entry)
    );
  }

  /**
   * Subscribe to hook events with debouncing
   * Returns an unsubscribe function
   */
  onHookTriggered(callback: () => void, debounceMs: number = 100): () => void {
    let timeoutId: NodeJS.Timeout | null = null;

    const debouncedCallback = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        callback();
        timeoutId = null;
      }, debounceMs);
    };

    this.on('hook-triggered', debouncedCallback);

    // Return unsubscribe function
    return () => {
      this.off('hook-triggered', debouncedCallback);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }

  /**
   * Clean up on shutdown
   */
  async cleanup(): Promise<void> {
    // Optionally uninstall hooks on shutdown
    // For now, we leave them installed so they work across restarts
    this.removeAllListeners();
  }
}

export default TmuxHookManager.getInstance();
