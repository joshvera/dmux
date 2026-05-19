import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyDmuxPerfPaneOption,
  classifyDmuxPerfErrorKind,
  classifyTmuxCommand,
  classifyTmuxCommandTarget,
  configureDmuxPerfMetadata,
  normalizeDmuxPerfPaneOptionKind,
  normalizeDmuxPerfCurrentPaneContext,
  recordDmuxPerfEvent,
  recordDmuxPerfInput,
  recordDmuxPerfRender,
  resetDmuxPerfForTests,
  timeDmuxPerfSync,
  writeDmuxPerfTransportRttEvent,
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

  it('uses perf environment labels for worker-thread events before metadata is configured', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-worker';
    process.env.DMUX_PERF_INSTANCE = 'instance-worker';
    process.env.DMUX_PERF_TRANSPORT = 'local-tmux';

    recordDmuxPerfEvent('worker.capture', {
      durationMs: 20,
      tmuxPaneId: '%1',
    });

    expect(readEvents(tempDir)).toContainEqual(
      expect.objectContaining({
        runId: 'run-worker',
        instanceLabel: 'instance-worker',
        transport: 'local-tmux',
        event: 'worker.capture',
      })
    );
  });

  it('measures keypress-to-render latency without logging input contents', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-input';

    const span = recordDmuxPerfInput({ surface: 'main', keyKind: 'printable' });
    span.classify({
      classification: 'handled',
      reason: 'test-navigation',
      actionKind: 'navigation',
      visibleStateChanged: true,
    });
    span.armKeyToRender();
    span.finish();
    recordDmuxPerfRender();

    const events = readEvents(tempDir);
    const input = events.find((event) => event.event === 'ui.input');
    const keyToRender = events.find((event) => event.event === 'ui.key_to_render');
    expect(input?.metadata).toMatchObject({
      surface: 'main',
      keyKind: 'printable',
      classification: 'handled',
      reason: 'test-navigation',
      actionKind: 'navigation',
      visibleStateChanged: true,
    });
    expect(keyToRender?.durationMs).toBeGreaterThanOrEqual(0);
    expect(keyToRender?.metadata).toMatchObject({
      keyKind: 'printable',
      classification: 'handled',
      visibleStateChanged: true,
    });
    expect(JSON.stringify(events)).not.toContain('literal-key');
  });

  it('does not measure ignored, noop, or unhandled inputs as key-to-render', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-classification';

    const ignored = recordDmuxPerfInput({ surface: 'main', keyKind: 'escape' });
    ignored.classify({
      classification: 'ignored',
      reason: 'busy',
      visibleStateChanged: false,
    });
    ignored.finish();

    const noop = recordDmuxPerfInput({ surface: 'main', keyKind: 'arrow' });
    noop.classify({
      classification: 'noop',
      reason: 'navigation-boundary',
      actionKind: 'navigation',
      visibleStateChanged: false,
    });
    noop.finish();

    recordDmuxPerfInput({ surface: 'main', keyKind: 'unknown' }).finish();
    recordDmuxPerfRender();

    const events = readEvents(tempDir);
    expect(events.filter((event) => event.event === 'ui.input')).toHaveLength(3);
    expect(events.some((event) => event.event === 'ui.key_to_render')).toBe(false);
    expect(events.map((event) => event.metadata).filter(Boolean)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classification: 'ignored' }),
        expect.objectContaining({ classification: 'noop' }),
        expect.objectContaining({ classification: 'unhandled' }),
      ])
    );
  });

  it('keeps input spans idempotent after finish', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-idempotent';

    const span = recordDmuxPerfInput({ surface: 'main', keyKind: 'enter' });
    span.classify({
      classification: 'handled',
      reason: 'first',
      visibleStateChanged: false,
    });
    span.finish();
    span.classify({
      classification: 'handled',
      reason: 'late',
      visibleStateChanged: true,
    });
    span.armKeyToRender();
    span.finish();
    recordDmuxPerfRender();

    const events = readEvents(tempDir);
    expect(events.filter((event) => event.event === 'ui.input')).toHaveLength(1);
    expect(events.some((event) => event.event === 'ui.key_to_render')).toBe(false);
    expect(events[0].metadata).toMatchObject({
      classification: 'handled',
      reason: 'first',
      visibleStateChanged: false,
    });
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

  it('writes sanitized client transport RTT events separately from server instrumentation', () => {
    process.env.DMUX_PERF_DIR = tempDir;
    delete process.env.DMUX_PERF;

    writeDmuxPerfTransportRttEvent({
      runId: 'run-transport',
      instanceLabel: 'instance-a',
      transport: 'eternal-terminal',
      durationMs: 101,
      sequence: 7,
    });

    const event = readEvents(tempDir).find((candidate) => candidate.event === 'client.transport_rtt');
    expect(event).toMatchObject({
      runId: 'run-transport',
      instanceLabel: 'instance-a',
      transport: 'eternal-terminal',
      lane: 'client-observed',
      durationMs: 101,
      metadata: {
        source: 'eternal-terminal',
        parser: 'keepalive-log',
        sequence: 7,
      },
    });
    expect(JSON.stringify(event)).not.toContain('/Users/vera');
    expect(JSON.stringify(event)).not.toContain('finn');
  });

  it('classifies tmux commands without storing full command text', () => {
    expect(classifyTmuxCommand("tmux list-panes -F '#{pane_id}'")).toBe('list-panes');
    expect(classifyTmuxCommand("tmux capture-pane -t '%1' -p")).toBe('capture-pane');
    expect(classifyTmuxCommand("tmux display-message -p '#{pid}'")).toBe('display-message');
    expect(classifyTmuxCommand("tmux set-option -p -t '%1' @dmux_title foo")).toBe('set-option');
    expect(classifyTmuxCommand('tmux send-keys -t %1 Enter')).toBe('send-keys');
    expect(classifyTmuxCommand("tmux select-pane -t '%1'")).toBe('select-pane');
    expect(classifyTmuxCommand('tmux resize-window -x 120 -y 40')).toBe('resize');
    expect(classifyTmuxCommand("tmux paste-buffer -b 'dmux-test' -t '%1'")).toBe('buffer');
  });

  it('classifies tmux attribution metadata without storing raw command text or errors', () => {
    expect(classifyTmuxCommandTarget("tmux send-keys -t '%1' Enter")).toBe('pane');
    expect(classifyTmuxCommandTarget("tmux resize-window -x 120 -y 40")).toBe('window');
    expect(classifyTmuxCommandTarget("tmux refresh-client")).toBe('client');
    expect(classifyTmuxCommandTarget("tmux set-option -g status off")).toBe('global');
    expect(classifyDmuxPerfErrorKind(new Error("can't find pane: %99"))).toBe('missing-target');
    expect(
      classifyDmuxPerfErrorKind(Object.assign(new Error('operation timeout'), { killed: true }))
    ).toBe('timeout');
  });

  it('classifies pane option metadata with a bounded enum', () => {
    expect(classifyDmuxPerfPaneOption('@dmux_title_prefix')).toBe('dmux-title-prefix');
    expect(classifyDmuxPerfPaneOption('@dmux_title_label')).toBe('dmux-title-label');
    expect(classifyDmuxPerfPaneOption('@dmux_active_border_style')).toBe('dmux-active-border-style');
    expect(classifyDmuxPerfPaneOption('@dmux_attention')).toBe('dmux-attention');
    expect(classifyDmuxPerfPaneOption('@dmux_welcome_theme')).toBe('dmux-welcome-theme');
    expect(classifyDmuxPerfPaneOption('window-style')).toBe('window-style');
    expect(classifyDmuxPerfPaneOption('/Users/vera/raw-option')).toBe('other');
    expect(normalizeDmuxPerfPaneOptionKind('dmux-title-prefix')).toBe('dmux-title-prefix');
    expect(normalizeDmuxPerfPaneOptionKind('/Users/vera/raw-option')).toBe('other');
  });

  it('records failed tmux timings with coarse errorKind instead of raw error metadata', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-tmux-error';

    expect(() => timeDmuxPerfSync(
      'tmux.command',
      {
        commandKind: 'send-keys',
        source: 'tmux-service',
        targetKind: 'pane',
        sync: true,
      },
      () => {
        throw new Error("can't find pane: %99");
      }
    )).toThrow("can't find pane");

    const tmuxEvent = readEvents(tempDir).find((event) => event.event === 'tmux.command');
    expect(tmuxEvent).toMatchObject({
      commandKind: 'send-keys',
      source: 'tmux-service',
      targetKind: 'pane',
      sync: true,
      success: false,
      errorKind: 'missing-target',
    });
    expect(tmuxEvent?.metadata).toBeUndefined();
    expect(JSON.stringify(tmuxEvent)).not.toContain('%99');
  });

  it('records finite tmux operation labels without raw commands', () => {
    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-tmux-operation';

    timeDmuxPerfSync(
      'tmux.command',
      {
        commandKind: 'display-message',
        operation: 'pane-window',
        source: 'tmux-service',
        targetKind: 'pane',
        sync: true,
      },
      () => 'ok'
    );

    const tmuxEvent = readEvents(tempDir).find((event) => event.event === 'tmux.command');
    expect(tmuxEvent).toMatchObject({
      commandKind: 'display-message',
      operation: 'pane-window',
    });
    expect(JSON.stringify(tmuxEvent)).not.toContain('display-message -t');
  });

  it('keeps current-pane caller context bounded', () => {
    expect(normalizeDmuxPerfCurrentPaneContext('input-handling')).toBe('input-handling');
    expect(normalizeDmuxPerfCurrentPaneContext('/Users/vera/project')).toBe('unknown');

    process.env.DMUX_PERF = '1';
    process.env.DMUX_PERF_DIR = tempDir;
    process.env.DMUX_PERF_RUN_ID = 'run-current-pane-context';

    timeDmuxPerfSync(
      'tmux.command',
      {
        commandKind: 'display-message',
        operation: 'current-pane',
        source: 'tmux-service',
        targetKind: 'server',
        sync: true,
        metadata: { currentPaneContext: 'input-handling' },
      },
      () => 'ok'
    );

    const tmuxEvent = readEvents(tempDir).find((event) => event.event === 'tmux.command');
    expect(tmuxEvent).toMatchObject({
      commandKind: 'display-message',
      operation: 'current-pane',
      metadata: { currentPaneContext: 'input-handling' },
    });
    expect(JSON.stringify(tmuxEvent)).not.toContain('/Users/vera');
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
