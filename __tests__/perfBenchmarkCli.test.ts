import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface JsonEvent {
  event?: string;
  lane?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

describe('perfBenchmarkCli collect-client', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-perf-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('requires --duration-ms when collect-client runs without an interactive TTY', () => {
    const result = runCollectClient([
      '--run-id',
      'run-no-duration',
      '--instance',
      'instance-a',
      '--transport',
      'ssh',
      '--iterations',
      '1',
      '--timeout-ms',
      '1',
    ]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'collect-client requires --duration-ms when stdin/stdout are noninteractive'
    );
  });

  it('writes a coarse client.input_window summary when DSR is unsupported', () => {
    const result = runCollectClient([
      '--run-id',
      'run-input-window',
      '--instance',
      'instance-a',
      '--transport',
      'ssh',
      '--label',
      'navigation',
      '--iterations',
      '1',
      '--timeout-ms',
      '1',
      '--duration-ms',
      '1',
    ]);

    expect(result.status).toBe(0);
    const events = readEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'client.terminal_roundtrip',
        lane: 'client-observed',
        metadata: expect.objectContaining({
          result: 'error',
          errorKind: 'unsupported-tty',
        }),
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'client.input_window',
        lane: 'client-observed',
        durationMs: expect.any(Number),
        metadata: expect.objectContaining({
          label: 'navigation',
          handledVisibleInputCount: expect.any(Number),
          matchedKeyToRenderCount: expect.any(Number),
          renderCount: expect.any(Number),
          dsrSupported: false,
          dsrError: expect.any(Number),
        }),
      })
    );
  });

  function runCollectClient(args: string[]): ReturnType<typeof spawnSync> {
    return spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/utils/perfBenchmarkCli.ts', 'collect-client', ...args],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          DMUX_PERF_DIR: tempDir,
        },
      }
    );
  }

  function readEvents(): JsonEvent[] {
    return fs.readdirSync(tempDir)
      .filter((file) => file.endsWith('.jsonl'))
      .flatMap((file) => fs.readFileSync(path.join(tempDir, file), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JsonEvent));
  }
});
