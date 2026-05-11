import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifySessionOwnership,
  isControllerProcessAlive,
  shouldPublishRuntimeMetadata,
} from '../src/utils/sessionOwnership.js';

const CURRENT_PROJECT_ROOT = '/sample/projects/dmux-fixture';
const FOREIGN_PROJECT_ROOT = '/sample/projects/foreign-fixture';

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
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: FOREIGN_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: CURRENT_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: CURRENT_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: CURRENT_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: CURRENT_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: CURRENT_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: CURRENT_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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
        sessionProjectRoot: FOREIGN_PROJECT_ROOT,
      },
      currentProjectRoot: CURRENT_PROJECT_ROOT,
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

describe('isControllerProcessAlive', () => {
  it('treats successful probes as alive', () => {
    const probeCalls: Array<[number, 0]> = [];
    const probe = (pid: number, signal: 0) => {
      probeCalls.push([pid, signal]);
    };

    expect(isControllerProcessAlive(1234, probe)).toBe(true);
    expect(probeCalls).toEqual([[1234, 0]]);
  });

  it('treats EPERM as alive', () => {
    const probe = () => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    };

    expect(isControllerProcessAlive(1234, probe)).toBe(true);
  });

  it('treats ESRCH as dead', () => {
    const probe = () => {
      const error = new Error('no such process') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    };

    expect(isControllerProcessAlive(1234, probe)).toBe(false);
  });

  it('treats unknown probe failures as alive', () => {
    const probe = () => {
      const error = new Error('probe failed') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    };

    expect(isControllerProcessAlive(1234, probe)).toBe(true);
  });
});
