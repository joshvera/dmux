import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  parseHookPayloadWriterOptions,
  writeHookPayload,
} from '../src/utils/tmuxHookPayloadWriter.js';

function base64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

describe('tmuxHookPayloadWriter', () => {
  it('writes structural hook payload JSONL without active pane ids', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-hook-writer-'));
    const eventLogPath = path.join(dir, 'events.jsonl');

    writeHookPayload({
      eventLogPath,
      eventType: 'panes-changed',
      pid: 123,
      sessionName: 'dmux-test',
    });

    const payload = JSON.parse(fs.readFileSync(eventLogPath, 'utf-8'));
    expect(payload).toMatchObject({
      schemaVersion: 1,
      eventType: 'panes-changed',
      pid: 123,
      sessionName: 'dmux-test',
    });
    expect(payload).not.toHaveProperty('activePaneId');
    expect(typeof payload.timestamp).toBe('number');
  });

  it('requires active pane ids for focus hook payloads', () => {
    expect(() => parseHookPayloadWriterOptions([
      '--event-log-b64',
      base64('/tmp/hooks.jsonl'),
      '--event-type',
      'pane-focus-changed',
      '--pid',
      '123',
      '--session-b64',
      base64('dmux-test'),
    ])).toThrow(/active-pane-id/);
  });
});
