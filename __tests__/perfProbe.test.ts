import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDsrParser,
  runTerminalDsrRoundtrip,
  runTerminalRoundtripProbe,
  writeTerminalRoundtripEvent,
  type SignalTarget,
  type TerminalDataListener,
  type TerminalErrorListener,
  type TerminalInput,
  type TerminalOutput,
} from '../src/utils/perfProbe.js';

describe('perfProbe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses partial terminal DSR responses without exposing row or column', () => {
    const parser = createDsrParser();

    expect(parser.push('\u001b[12')).toBe(false);
    expect(parser.push(';80R')).toBe(true);
  });

  it('writes DSR, resolves on response, and restores raw mode', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const signal = new FakeSignal();

    const probe = runTerminalDsrRoundtrip({
      input: input as TerminalInput,
      output: output as TerminalOutput,
      signalTarget: signal,
      timeoutMs: 1000,
    });

    expect(output.writes).toEqual(['\u001b[6n']);
    expect(input.rawModes).toEqual([true]);

    input.emitData('\u001b[10;20R');

    await expect(probe).resolves.toMatchObject({ result: 'success' });
    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(signal.sigintListenerCount).toBe(0);
  });

  it('times out cleanly after partial responses and restores raw mode', async () => {
    vi.useFakeTimers();
    const input = new FakeInput();
    const output = new FakeOutput();

    const probe = runTerminalDsrRoundtrip({
      input: input as TerminalInput,
      output: output as TerminalOutput,
      timeoutMs: 25,
    });

    input.emitData('\u001b[10');
    await vi.advanceTimersByTimeAsync(25);

    await expect(probe).resolves.toMatchObject({ result: 'timeout' });
    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
  });

  it('restores raw mode on SIGINT', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const signal = new FakeSignal();

    const probe = runTerminalDsrRoundtrip({
      input: input as TerminalInput,
      output: output as TerminalOutput,
      signalTarget: signal,
      timeoutMs: 1000,
    });

    signal.emitSigint();

    await expect(probe).resolves.toMatchObject({
      result: 'error',
      errorKind: 'sigint',
      interrupted: true,
    });
    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
  });

  it('records unsupported non-TTY runs without writing terminal control bytes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-perf-probe-test-'));
    try {
      const filePath = path.join(tempDir, 'probe.jsonl');
      const input = new FakeInput();
      const output = new FakeOutput();
      input.isTTY = false;

      const run = await runTerminalRoundtripProbe({
        runId: 'run-probe',
        instanceLabel: 'instance-a',
        transport: 'eternal-terminal',
        iterations: 50,
        timeoutMs: 1000,
        input: input as TerminalInput,
        output: output as TerminalOutput,
        filePath,
      });

      expect(run.supported).toBe(false);
      expect(output.writes).toEqual([]);
      expect(readEvents(filePath)).toContainEqual(
        expect.objectContaining({
          event: 'client.terminal_roundtrip',
          lane: 'client-observed',
          durationMs: 0,
          metadata: expect.objectContaining({
            probe: 'terminal-dsr',
            iteration: 1,
            result: 'error',
            errorKind: 'unsupported-tty',
          }),
        })
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists only result metadata for terminal roundtrip events', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-perf-probe-test-'));
    try {
      const filePath = path.join(tempDir, 'probe.jsonl');

      writeTerminalRoundtripEvent({
        runId: 'run-probe',
        instanceLabel: 'instance-a',
        transport: 'ssh',
        iteration: 7,
        durationMs: 12.5,
        result: 'success',
        filePath,
      });

      const [event] = readEvents(filePath);
      expect(event).toMatchObject({
        event: 'client.terminal_roundtrip',
        lane: 'client-observed',
        durationMs: 12.5,
        metadata: {
          probe: 'terminal-dsr',
          iteration: 7,
          result: 'success',
        },
      });
      expect(JSON.stringify(event)).not.toContain('10;20');
      expect(JSON.stringify(event)).not.toContain('\u001b');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

class FakeInput {
  isTTY = true;
  isRaw = false;
  paused = true;
  readonly rawModes: boolean[] = [];
  private readonly dataListeners = new Set<TerminalDataListener>();
  private readonly errorListeners = new Set<TerminalErrorListener>();

  setRawMode(mode: boolean): FakeInput {
    this.isRaw = mode;
    this.rawModes.push(mode);
    return this;
  }

  resume(): FakeInput {
    this.paused = false;
    return this;
  }

  pause(): FakeInput {
    this.paused = true;
    return this;
  }

  isPaused(): boolean {
    return this.paused;
  }

  on(
    event: 'data' | 'error',
    listener: TerminalDataListener | TerminalErrorListener
  ): FakeInput {
    if (event === 'data') {
      this.dataListeners.add(listener as TerminalDataListener);
    } else {
      this.errorListeners.add(listener as TerminalErrorListener);
    }
    return this;
  }

  off(
    event: 'data' | 'error',
    listener: TerminalDataListener | TerminalErrorListener
  ): FakeInput {
    if (event === 'data') {
      this.dataListeners.delete(listener as TerminalDataListener);
    } else {
      this.errorListeners.delete(listener as TerminalErrorListener);
    }
    return this;
  }

  removeListener(
    event: 'data' | 'error',
    listener: TerminalDataListener | TerminalErrorListener
  ): FakeInput {
    return this.off(event, listener);
  }

  emitData(chunk: string): void {
    for (const listener of this.dataListeners) {
      listener(chunk);
    }
  }
}

class FakeOutput {
  isTTY = true;
  readonly writes: string[] = [];
  private readonly errorListeners = new Set<TerminalErrorListener>();

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  on(event: 'error', listener: TerminalErrorListener): FakeOutput {
    this.errorListeners.add(listener);
    return this;
  }

  off(event: 'error', listener: TerminalErrorListener): FakeOutput {
    this.errorListeners.delete(listener);
    return this;
  }

  removeListener(event: 'error', listener: TerminalErrorListener): FakeOutput {
    return this.off(event, listener);
  }
}

class FakeSignal implements SignalTarget {
  private readonly sigintListeners = new Set<() => void>();

  get sigintListenerCount(): number {
    return this.sigintListeners.size;
  }

  once(event: 'SIGINT', listener: () => void): SignalTarget {
    this.sigintListeners.add(listener);
    return this;
  }

  off(event: 'SIGINT', listener: () => void): SignalTarget {
    this.sigintListeners.delete(listener);
    return this;
  }

  removeListener(event: 'SIGINT', listener: () => void): SignalTarget {
    return this.off(event, listener);
  }

  emitSigint(): void {
    for (const listener of [...this.sigintListeners]) {
      listener();
    }
  }
}

function readEvents(filePath: string): Array<Record<string, unknown>> {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
