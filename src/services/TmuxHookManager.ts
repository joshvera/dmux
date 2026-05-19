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
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execAsync } from '../utils/execAsync.js';
import {
  buildHookPayloadRunShellCommand,
  buildPaneExitedHookCommandForSession,
  buildPaneFocusHookCommandForSession,
  DMUX_HOOK_MARKER_V2,
} from '../utils/tmuxHookCommands.js';
import { LogService } from './LogService.js';

export type HookEvent = 'pane-created' | 'pane-closed' | 'pane-resized' | 'pane-focus-changed';
export type TmuxHookPayloadEventType = 'panes-changed' | 'pane-focus-changed';

export interface TmuxHookPayload {
  schemaVersion: 1;
  eventType: TmuxHookPayloadEventType;
  timestamp: number;
  pid: number;
  sessionName: string;
  activePaneId?: string;
}

export type TmuxHookSignalEvent =
  | {
    type: 'payload';
    payload: TmuxHookPayload;
  }
  | {
    type: 'fallback';
    timestamp: number;
  };

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
const LEGACY_DMUX_HOOK_MARKER = '# dmux-hook';
const MAX_HOOK_EVENT_LOG_BYTES = 1024 * 1024;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTmuxHookPayloadEventType(value: unknown): value is TmuxHookPayloadEventType {
  return value === 'panes-changed' || value === 'pane-focus-changed';
}

export function parseTmuxHookPayloadLine(
  line: string,
  expected: { pid: number; sessionName: string }
): TmuxHookPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }
  if (parsed.schemaVersion !== 1) {
    return null;
  }
  if (!isTmuxHookPayloadEventType(parsed.eventType)) {
    return null;
  }
  if (parsed.pid !== expected.pid || parsed.sessionName !== expected.sessionName) {
    return null;
  }
  if (typeof parsed.timestamp !== 'number' || !Number.isFinite(parsed.timestamp)) {
    return null;
  }

  if (parsed.eventType === 'pane-focus-changed') {
    if (typeof parsed.activePaneId !== 'string' || parsed.activePaneId.length === 0) {
      return null;
    }
    return {
      schemaVersion: 1,
      eventType: parsed.eventType,
      timestamp: parsed.timestamp,
      pid: parsed.pid,
      sessionName: parsed.sessionName,
      activePaneId: parsed.activePaneId,
    };
  }

  return {
    schemaVersion: 1,
    eventType: parsed.eventType,
    timestamp: parsed.timestamp,
    pid: parsed.pid,
    sessionName: parsed.sessionName,
  };
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
  private hookEventLogPath: string | null = null;
  private hookEventLogOffset = 0;

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
    this.prepareHookEventLog(sessionName);
    this.setupSignalHandler();
  }

  getHookEventLogPath(): string | null {
    return this.hookEventLogPath;
  }

  private prepareHookEventLog(sessionName: string): void {
    const sessionHash = createHash('sha1').update(sessionName).digest('hex').slice(0, 12);
    const hookEventDir = path.join(os.tmpdir(), 'dmux', 'hooks');
    this.hookEventLogPath = path.join(hookEventDir, `${sessionHash}-${this.pid}.jsonl`);
    this.hookEventLogOffset = 0;

    try {
      fs.mkdirSync(hookEventDir, { recursive: true });
      fs.writeFileSync(this.hookEventLogPath, '', 'utf-8');
    } catch (error) {
      this.logger.debug(`Failed to prepare tmux hook event log: ${error}`, 'hooks');
    }
  }

  /**
   * Set up the SIGUSR2 signal handler to receive hook notifications
   */
  private setupSignalHandler(): void {
    if (this.signalHandlerSetup) return;

    process.on('SIGUSR2', () => {
      this.logger.debug('Received SIGUSR2 signal from tmux hook', 'hooks');
      this.emit('hook-triggered', this.drainHookSignalEvents());
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
        this.shouldReplaceDmuxHook(entry)
      );

      for (const entry of staleDmuxEntries) {
        await execAsync(
          `tmux set-hook -u -t ${shellQuote(this.sessionName)} ${shellQuote(entry.target)}`,
          { timeout: 2000 }
        );
      }
      const retainedEntries = existingEntries.filter((entry) =>
        !this.shouldReplaceDmuxHook(entry)
      );
      const hookEventLogPath = this.hookEventLogPath;
      if (!hookEventLogPath) {
        throw new Error('tmux hook event log path is not initialized');
      }

      // Create hook commands that send SIGUSR2 to this process
      // We add a comment marker so we can identify our hooks later
      const paneExitedHookCommand = buildPaneExitedHookCommandForSession(
        this.pid,
        this.sessionName,
        hookEventLogPath
      );
      const paneFocusHookCommand = buildPaneFocusHookCommandForSession(
        this.sessionName,
        this.pid,
        hookEventLogPath
      );
      const hookCommands: Array<{ hookName: keyof typeof HOOK_CONFIG; command: string }> = [
        // Pane split (new pane created)
        {
          hookName: 'after-split-window',
          command: buildHookPayloadRunShellCommand({
            eventLogPath: hookEventLogPath,
            eventType: 'panes-changed',
            pid: this.pid,
            sessionName: this.sessionName,
          }),
        },
        // Pane closed (includes control-pane recovery if needed)
        {
          hookName: 'after-kill-pane',
          command: paneExitedHookCommand,
        },
        // Window/client resized
        {
          hookName: 'client-resized',
          command: buildHookPayloadRunShellCommand({
            eventLogPath: hookEventLogPath,
            eventType: 'panes-changed',
            pid: this.pid,
            sessionName: this.sessionName,
          }),
        },
        // Pane focus changed
        {
          hookName: 'after-select-pane',
          command: paneFocusHookCommand,
        },
      ];

      for (const hookCommand of hookCommands) {
        if (this.hasCurrentDmuxHook(retainedEntries, hookCommand.hookName)) {
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
        this.isCurrentProcessDmuxHook(entry) || this.isStaleDmuxHook(entry)
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
    return command.includes(LEGACY_DMUX_HOOK_MARKER);
  }

  private isV2DmuxHook(command: string): boolean {
    return command.includes(DMUX_HOOK_MARKER_V2);
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
    return hookPid === this.pid
      && this.isV2DmuxHook(entry.command)
      && this.isProcessAlive(hookPid);
  }

  private isCurrentProcessDmuxHook(entry: TmuxHookEntry): boolean {
    const hookPid = this.extractDmuxHookPid(entry.command);
    return hookPid === this.pid && this.isProcessAlive(hookPid);
  }

  private isStaleDmuxHook(entry: TmuxHookEntry): boolean {
    const hookPid = this.extractDmuxHookPid(entry.command);
    return hookPid !== null && hookPid !== this.pid && !this.isProcessAlive(hookPid);
  }

  private shouldReplaceDmuxHook(entry: TmuxHookEntry): boolean {
    const hookPid = this.extractDmuxHookPid(entry.command);
    if (hookPid === null) {
      return false;
    }

    if (hookPid === this.pid) {
      return !this.isV2DmuxHook(entry.command) || !this.isProcessAlive(hookPid);
    }

    return !this.isProcessAlive(hookPid);
  }

  private hasCurrentDmuxHook(
    entries: TmuxHookEntry[],
    hookName: keyof typeof HOOK_CONFIG
  ): boolean {
    return entries.some((entry) =>
      entry.hookName === hookName && this.isCurrentDmuxHook(entry)
    );
  }

  private createFallbackEvent(): TmuxHookSignalEvent {
    return {
      type: 'fallback',
      timestamp: Date.now(),
    };
  }

  private drainHookSignalEvents(): TmuxHookSignalEvent[] {
    if (!this.hookEventLogPath) {
      return [this.createFallbackEvent()];
    }

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(this.hookEventLogPath);
    } catch (error) {
      this.logger.debug(`Failed to read tmux hook event log: ${error}`, 'hooks');
      return [this.createFallbackEvent()];
    }

    if (this.hookEventLogOffset > buffer.length) {
      this.hookEventLogOffset = 0;
    }

    const pendingBuffer = buffer.subarray(this.hookEventLogOffset);
    if (pendingBuffer.length === 0) {
      return [this.createFallbackEvent()];
    }

    const lastNewlineIndex = pendingBuffer.lastIndexOf(10);
    if (lastNewlineIndex === -1) {
      this.logger.debug('Tmux hook event log has no complete payload line yet', 'hooks');
      return [this.createFallbackEvent()];
    }

    const consumedByteCount = lastNewlineIndex + 1;
    const completePayloadText = pendingBuffer
      .subarray(0, consumedByteCount)
      .toString('utf-8');
    this.hookEventLogOffset += consumedByteCount;

    const events = completePayloadText
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line): TmuxHookSignalEvent => {
        const payload = parseTmuxHookPayloadLine(line, {
          pid: this.pid,
          sessionName: this.sessionName,
        });

        if (!payload) {
          this.logger.debug('Malformed tmux hook payload; falling back to broad invalidation', 'hooks');
          return this.createFallbackEvent();
        }

        return {
          type: 'payload',
          payload,
        };
      });

    this.compactHookEventLog(buffer.length);
    return events.length > 0 ? events : [this.createFallbackEvent()];
  }

  private compactHookEventLog(currentSize: number): void {
    if (!this.hookEventLogPath) {
      return;
    }
    if (currentSize <= MAX_HOOK_EVENT_LOG_BYTES || this.hookEventLogOffset < currentSize) {
      return;
    }

    try {
      fs.writeFileSync(this.hookEventLogPath, '', 'utf-8');
      this.hookEventLogOffset = 0;
    } catch (error) {
      this.logger.debug(`Failed to compact tmux hook event log: ${error}`, 'hooks');
    }
  }

  /**
   * Subscribe to hook events with debouncing
   * Returns an unsubscribe function
   */
  onHookTriggered(
    callback: (events: TmuxHookSignalEvent[]) => void,
    debounceMs: number = 100
  ): () => void {
    let timeoutId: NodeJS.Timeout | null = null;
    let pendingEvents: TmuxHookSignalEvent[] = [];

    const debouncedCallback = (events: TmuxHookSignalEvent[]) => {
      pendingEvents = pendingEvents.concat(events);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        const eventsToFlush = pendingEvents;
        pendingEvents = [];
        callback(eventsToFlush);
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
