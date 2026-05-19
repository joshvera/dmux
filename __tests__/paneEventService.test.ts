import { describe, expect, it } from 'vitest';
import { resolvePaneEventsFromHookSignals } from '../src/services/PaneEventService.js';
import type { TmuxHookSignalEvent } from '../src/services/TmuxHookManager.js';

const basePayload = {
  schemaVersion: 1,
  timestamp: 100,
  pid: 123,
  sessionName: 'dmux-test',
} as const;

describe('PaneEventService hook routing', () => {
  it('routes focus-only hook payloads without triggering pane reloads', () => {
    const events = resolvePaneEventsFromHookSignals([
      {
        type: 'payload',
        payload: {
          ...basePayload,
          eventType: 'pane-focus-changed',
          activePaneId: '%7',
        },
      },
    ]);

    expect(events).toEqual([
      {
        type: 'pane-focus-changed',
        activePaneId: '%7',
        timestamp: 100,
        source: 'hooks',
      },
    ]);
  });

  it('lets structural changes win over coalesced focus-only payloads', () => {
    const events = resolvePaneEventsFromHookSignals([
      {
        type: 'payload',
        payload: {
          ...basePayload,
          eventType: 'pane-focus-changed',
          activePaneId: '%7',
        },
      },
      {
        type: 'payload',
        payload: {
          ...basePayload,
          eventType: 'panes-changed',
          timestamp: 200,
        },
      },
    ]);

    expect(events).toEqual([
      {
        type: 'panes-changed',
        timestamp: 200,
        source: 'hooks',
      },
    ]);
  });

  it('falls back to broad invalidation when payload evidence is missing', () => {
    const events = resolvePaneEventsFromHookSignals([
      {
        type: 'fallback',
        timestamp: 999,
      },
    ], 999);

    expect(events.map((event) => event.type)).toEqual([
      'panes-changed',
      'pane-focus-changed',
    ]);
    expect(events.every((event) => event.timestamp === 999)).toBe(true);
  });

  it('uses the latest focus payload in a focus burst', () => {
    const events = resolvePaneEventsFromHookSignals([
      {
        type: 'payload',
        payload: {
          ...basePayload,
          eventType: 'pane-focus-changed',
          activePaneId: '%7',
        },
      },
      {
        type: 'payload',
        payload: {
          ...basePayload,
          eventType: 'pane-focus-changed',
          timestamp: 300,
          activePaneId: '%9',
        },
      },
    ] satisfies TmuxHookSignalEvent[]);

    expect(events).toEqual([
      {
        type: 'pane-focus-changed',
        activePaneId: '%9',
        timestamp: 300,
        source: 'hooks',
      },
    ]);
  });
});
