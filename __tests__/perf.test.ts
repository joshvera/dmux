import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyTmuxCommand,
  configureDmuxPerfMetadata,
  recordDmuxPerfEvent,
  recordDmuxPerfInput,
  recordDmuxPerfRender,
  resetDmuxPerfForTests,
  writeDmuxPerfClientMarker,
} from '../src/utils/perf.js';

const ENV_KEYS = [
  'DMUX_PERF',
  'DMUX_PERF_DIR',
  'DMUX_PERF_RUN_ID',
  'DMUX_PERF_INSTANCE',
  'DMUX_PERF_TRANSPORT',
] as const;

describe('dmux perf logging', () => {
  let tempDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-perf-test-'));
    originalEnv = Object.fromEntries(
      ENV_KEYS.map((key) => [key, process.env[key]])
    );
    resetDmuxPerfForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const originalValue = originalEnv[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
    resetDmuxPerfForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not write server perf events unless DMUX_PERF is enabled', () => {
    process.env.DMUX_PERF_DIR = tempDir;
    delete process.env.DMUX_PERF;

    recordDmuxPerfEvent('test.event', { count: 1 });

    expect(readEvents(tempDir)).toEqual([]);
  });

  it('writes metadata and server events when enabled', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-test';
    process.env.DMUX_PERF_INSTANCE = 'instance-a';
    process.env.DMUX_PERF_TRANSPORT = 'ssh';

    configureDmuxPerfMetadata({
      sessionName: 'dmux-test',
      projectRoot: '/tmp/project',
      paneCount: 2,
      workerCount: 1,
    });
    recordDmuxPerfEvent('test.event', {
      durationMs: 12.5,
      metadata: { ok: true },
    });

    const events = readEvents(tempDir);
    expect(events.some((event) => event.event === 'perf.metadata')).toBe(true);
    const testEvent = events.find((event) => event.event === 'test.event');
    expect(testEvent).toMatchObject({
      runId: 'run-test',
      instanceLabel: 'instance-a',
      transport: 'ssh',
      lane: 'server-observed',
      durationMs: 12.5,
      sessionName: 'dmux-test',
    });
    expect(typeof testEvent?.projectRootHash).toBe('string');
  });

  it('measures keypress-to-render latency without logging input contents', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-input';

    recordDmuxPerfInput();
    recordDmuxPerfRender();

    const keyToRender = readEvents(tempDir).find((event) => event.event === 'ui.key_to_render');
    expect(keyToRender?.durationMs).toBeGreaterThanOrEqual(0);
    expect(keyToRender?.metadata).toBeUndefined();
  });

  it('writes client marker events separately from server instrumentation', () => {
    process.env.DMUX_PERF_DIR = tempDir;
    delete process.env.DMUX_PERF;

    writeDmuxPerfClientMarker({
      runId: 'run-client',
      instanceLabel: 'instance-b',
      transport: 'eternal-terminal',
      marker: 'navigation-start',
    });

    expect(readEvents(tempDir)).toContainEqual(
      expect.objectContaining({
        runId: 'run-client',
        instanceLabel: 'instance-b',
        transport: 'eternal-terminal',
        lane: 'client-observed',
        event: 'client.marker',
        metadata: expect.objectContaining({ marker: 'navigation-start' }),
      })
    );
  });

  it('classifies tmux commands without storing full command text', () => {
    expect(classifyTmuxCommand("tmux list-panes -F '#{pane_id}'")).toBe('list-panes');
    expect(classifyTmuxCommand("tmux capture-pane -t '%1' -p")).toBe('capture-pane');
    expect(classifyTmuxCommand("tmux display-message -p '#{pid}'")).toBe('display-message');
    expect(classifyTmuxCommand("tmux set-option -p -t '%1' @dmux_title foo")).toBe('set-option');
    expect(classifyTmuxCommand('tmux send-keys -t %1 Enter')).toBe('send-keys');
  });
});

function readEvents(dir: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => fs.readFileSync(path.join(dir, file), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>));
}
