#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type HookPayloadEventType = 'panes-changed' | 'pane-focus-changed';

interface HookPayloadWriterOptions {
  eventLogPath: string;
  eventType: HookPayloadEventType;
  pid: number;
  sessionName: string;
  activePaneId?: string;
}

function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf-8');
}

function isHookPayloadEventType(value: string | undefined): value is HookPayloadEventType {
  return value === 'panes-changed' || value === 'pane-focus-changed';
}

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

export function parseHookPayloadWriterOptions(args: string[]): HookPayloadWriterOptions {
  const eventLogB64 = readOption(args, '--event-log-b64');
  const eventType = readOption(args, '--event-type');
  const pidValue = readOption(args, '--pid');
  const sessionB64 = readOption(args, '--session-b64');

  if (!eventLogB64) {
    throw new Error('Missing --event-log-b64');
  }
  if (!isHookPayloadEventType(eventType)) {
    throw new Error('Invalid --event-type');
  }
  if (!pidValue) {
    throw new Error('Missing --pid');
  }
  if (!sessionB64) {
    throw new Error('Missing --session-b64');
  }

  const pid = Number(pidValue);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Invalid --pid');
  }

  const activePaneId = readOption(args, '--active-pane-id');
  if (eventType === 'pane-focus-changed' && !activePaneId) {
    throw new Error('Missing --active-pane-id for pane-focus-changed event');
  }

  return {
    eventLogPath: decodeBase64(eventLogB64),
    eventType,
    pid,
    sessionName: decodeBase64(sessionB64),
    activePaneId,
  };
}

export function writeHookPayload(options: HookPayloadWriterOptions): void {
  fs.mkdirSync(path.dirname(options.eventLogPath), { recursive: true });
  const payload = {
    schemaVersion: 1,
    eventType: options.eventType,
    timestamp: Date.now(),
    pid: options.pid,
    sessionName: options.sessionName,
    ...(options.eventType === 'pane-focus-changed'
      ? { activePaneId: options.activePaneId }
      : {}),
  };

  fs.appendFileSync(options.eventLogPath, `${JSON.stringify(payload)}\n`, 'utf-8');
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined
    && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  try {
    writeHookPayload(parseHookPayloadWriterOptions(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`dmux hook payload writer failed: ${message}`);
    process.exitCode = 1;
  }
}
