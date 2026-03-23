import { describe, expect, it } from 'vitest';
import { classifySessionOwnership } from '../src/utils/sessionOwnership.js';

describe('sessionOwnership', () => {
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
});
