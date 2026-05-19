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
          dsrErrorCount: expect.any(Number),
        }),
      })
    );
  });

  it('imports Eternal Terminal keepalive RTT samples with sanitized output', () => {
    const logPath = path.join(tempDir, 'etclient-vera-finn.log');
    fs.writeFileSync(logPath, [
      '[INFO 2026-05-17 16:26:42,000 /Users/vera/secret.cc:1] Writing keepalive packet',
      '[INFO 2026-05-17 16:26:42,125 finn.example /Users/vera/secret.cc:1] Got a keepalive',
      '[INFO 2026-05-17 16:26:43,000 finn.example /Users/vera/secret.cc:1] Got a keepalive',
    ].join('\n'));

    const result = runImportTransport([
      '--source',
      'eternal-terminal',
      '--log',
      logPath,
      '--run-id',
      'run-import',
      '--instance',
      'instance-a',
      '--transport',
      'eternal-terminal',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Imported transport RTT samples: 1');
    expect(result.stdout).toContain('unmatched-reads=1');
    expect(result.stdout).not.toContain(logPath);
    expect(result.stdout).not.toContain('vera');
    expect(result.stdout).not.toContain('finn');

    expect(readEvents()).toContainEqual(
      expect.objectContaining({
        event: 'client.transport_rtt',
        lane: 'client-observed',
        durationMs: 125,
        metadata: {
          source: 'eternal-terminal',
          parser: 'keepalive-log',
          sequence: 1,
        },
      })
    );
  });

  it('does not print the raw transport log path when import fails', () => {
    const missingLogPath = path.join(tempDir, 'etclient-vera-finn-missing.log');
    const result = runImportTransport([
      '--source',
      'eternal-terminal',
      '--log',
      missingLogPath,
      '--run-id',
      'run-missing-import',
    ]);

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain('failed to read transport log');
    expect(output).not.toContain(missingLogPath);
    expect(output).not.toContain('vera');
    expect(output).not.toContain('finn');
  });

  function runCollectClient(args: string[]): ReturnType<typeof spawnSync> {
    return runPerfBenchmarkCli('collect-client', args);
  }

  function runImportTransport(args: string[]): ReturnType<typeof spawnSync> {
    return runPerfBenchmarkCli('import-transport', args);
  }

  function runPerfBenchmarkCli(command: string, args: string[]): ReturnType<typeof spawnSync> {
    return spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/utils/perfBenchmarkCli.ts', command, ...args],
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
