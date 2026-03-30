import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifySessionOwnership,
  shouldPublishRuntimeMetadata,
} from '../src/utils/sessionOwnership.js';

describe('sessionOwnership', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('publishes metadata for dmux-prefixed host sessions without a managed-session context', () => {
    const classification = classifySessionOwnership({
      sessionName: 'dmux-devv',
      currentPaneId: '%17',
      controlPaneId: '%17',
      sessionContext: null,
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(classification.shouldOfferAttachToCurrentSession).toBe(false);
    expect(classification.shouldPublishRuntimeMetadata).toBe(true);
  });

  it('offers attach and skips metadata publication for foreign managed sessions', () => {
    const classification = classifySessionOwnership({
      sessionName: 'dmux-bankroll',
      currentPaneId: '%17',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/bankroll',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(classification.isForeignManagedSession).toBe(true);
    expect(classification.shouldOfferAttachToCurrentSession).toBe(true);
    expect(classification.shouldPublishRuntimeMetadata).toBe(false);
  });

  it('skips metadata publication for nested same-project sessions outside the control pane', () => {
    const classification = classifySessionOwnership({
      sessionName: 'dmux-dmux-0270e009',
      currentPaneId: '%19',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/dmux',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(classification.isForeignManagedSession).toBe(false);
    expect(classification.ownsCurrentSession).toBe(false);
    expect(classification.shouldPublishRuntimeMetadata).toBe(false);
  });

  it('publishes metadata for arbitrary non-dmux sessions when the control pane owns the session', () => {
    const classification = classifySessionOwnership({
      sessionName: 'workbench',
      currentPaneId: '%3',
      controlPaneId: '%3',
      sessionContext: null,
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(classification.shouldOfferAttachToCurrentSession).toBe(false);
    expect(classification.shouldPublishRuntimeMetadata).toBe(true);
  });

  it('does not treat same-project managed host sessions as foreign just because the name differs', () => {
    const classification = classifySessionOwnership({
      sessionName: 'dmux-devv',
      currentPaneId: '%17',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/dmux',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(classification.isForeignManagedSession).toBe(false);
    expect(classification.shouldOfferAttachToCurrentSession).toBe(false);
    expect(classification.shouldPublishRuntimeMetadata).toBe(true);
  });

  it('treats canonical-equivalent project roots as the same project', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-session-ownership-'));
    tempDirs.push(tempDir);

    const realProjectRoot = path.join(tempDir, 'real-project');
    const linkedProjectRoot = path.join(tempDir, 'linked-project');
    fs.mkdirSync(realProjectRoot, { recursive: true });
    fs.symlinkSync(realProjectRoot, linkedProjectRoot);

    const classification = classifySessionOwnership({
      sessionName: 'dmux-devv',
      currentPaneId: '%17',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: linkedProjectRoot,
      },
      currentProjectRoot: realProjectRoot,
    });

    expect(classification.isForeignManagedSession).toBe(false);
    expect(classification.shouldOfferAttachToCurrentSession).toBe(false);
    expect(classification.shouldPublishRuntimeMetadata).toBe(true);
  });
});

describe('shouldPublishRuntimeMetadata', () => {
  it('publishes metadata when the current pane still owns the same-project session', () => {
    const sessionOwnership = classifySessionOwnership({
      sessionName: 'dmux-devv',
      currentPaneId: '%17',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/dmux',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(
      shouldPublishRuntimeMetadata({
        sessionOwnership,
        currentPaneOwnsControlPane: true,
        hasRecordedControllerPid: true,
        isRecordedControllerAlive: true,
      })
    ).toBe(true);
  });

  it('skips metadata publication for nested same-project panes while the recorded controller is alive', () => {
    const sessionOwnership = classifySessionOwnership({
      sessionName: 'dmux-dmux-0270e009',
      currentPaneId: '%19',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/dmux',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(
      shouldPublishRuntimeMetadata({
        sessionOwnership,
        currentPaneOwnsControlPane: false,
        hasRecordedControllerPid: true,
        isRecordedControllerAlive: true,
      })
    ).toBe(false);
  });

  it('publishes metadata for nested same-project panes when controller metadata are missing', () => {
    const sessionOwnership = classifySessionOwnership({
      sessionName: 'dmux-dmux-0270e009',
      currentPaneId: '%19',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/dmux',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(
      shouldPublishRuntimeMetadata({
        sessionOwnership,
        currentPaneOwnsControlPane: false,
        hasRecordedControllerPid: false,
        isRecordedControllerAlive: false,
      })
    ).toBe(true);
  });

  it('publishes metadata for nested same-project panes when the recorded controller is stale', () => {
    const sessionOwnership = classifySessionOwnership({
      sessionName: 'dmux-dmux-0270e009',
      currentPaneId: '%19',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/dmux',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(
      shouldPublishRuntimeMetadata({
        sessionOwnership,
        currentPaneOwnsControlPane: false,
        hasRecordedControllerPid: true,
        isRecordedControllerAlive: false,
      })
    ).toBe(true);
  });

  it('still skips metadata publication for foreign managed sessions when controller metadata are stale', () => {
    const sessionOwnership = classifySessionOwnership({
      sessionName: 'dmux-bankroll',
      currentPaneId: '%19',
      controlPaneId: '%17',
      sessionContext: {
        sessionProjectRoot: '/Users/vera/github/bankroll',
      },
      currentProjectRoot: '/Users/vera/github/dmux',
    });

    expect(
      shouldPublishRuntimeMetadata({
        sessionOwnership,
        currentPaneOwnsControlPane: false,
        hasRecordedControllerPid: true,
        isRecordedControllerAlive: false,
      })
    ).toBe(false);
  });
});
