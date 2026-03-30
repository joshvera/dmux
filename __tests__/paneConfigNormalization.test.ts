import { describe, expect, it } from 'vitest';
import type { DmuxConfig, DmuxPane } from '../src/types.js';
import { normalizePaneConfigForSave } from '../src/utils/paneConfigNormalization.js';

const PANES_FILE = '/sample/projects/dmux-fixture/.dmux/dmux.config.json';
const FIXED_NOW = new Date('2026-03-29T12:34:56.000Z');

const LEGACY_PANES: DmuxPane[] = [
  {
    id: 'legacy-pane',
    slug: 'legacy-pane',
    prompt: 'legacy prompt',
    paneId: '%1',
  },
];

const REPLACEMENT_PANES: DmuxPane[] = [
  {
    id: 'replacement-pane',
    slug: 'replacement-pane',
    prompt: 'replacement prompt',
    paneId: '%2',
    projectRoot: '/sample/projects/linked-fixture',
    projectName: 'linked-fixture',
  },
];

describe('normalizePaneConfigForSave', () => {
  it('converts legacy array configs into object configs with replacement panes', () => {
    const config = normalizePaneConfigForSave(
      LEGACY_PANES,
      REPLACEMENT_PANES,
      PANES_FILE,
      FIXED_NOW
    );

    expect(Array.isArray(config)).toBe(false);
    expect(config.panes).toEqual(REPLACEMENT_PANES);
    expect(config.projectRoot).toBe('/sample/projects/dmux-fixture');
    expect(config.projectName).toBe('dmux-fixture');
    expect(config.lastUpdated).toBe('2026-03-29T12:34:56.000Z');
    expect(config.sidebarProjects).toEqual([
      {
        projectRoot: '/sample/projects/dmux-fixture',
        projectName: 'dmux-fixture',
      },
      {
        projectRoot: '/sample/projects/linked-fixture',
        projectName: 'linked-fixture',
      },
    ]);
  });

  it('preserves object-config fields while recomputing pane metadata', () => {
    const existingConfig: Partial<DmuxConfig> & Record<string, unknown> = {
      projectRoot: '/sample/projects/custom-root',
      projectName: 'Custom Root',
      panes: LEGACY_PANES,
      settings: {
        defaultAgent: 'claude',
      },
      sidebarProjects: [
        {
          projectRoot: '/sample/projects/sidebar-fixture',
          projectName: 'sidebar-fixture',
        },
      ],
      controlPaneId: '%10',
      controlPaneSize: 42,
      welcomePaneId: '%11',
      extraField: 'preserve-me',
    };

    const panes: DmuxPane[] = [
      {
        id: 'pane-project',
        slug: 'pane-project',
        prompt: 'pane prompt',
        paneId: '%12',
        projectRoot: '/sample/projects/pane-fixture',
        projectName: 'pane-fixture',
      },
    ];

    const config = normalizePaneConfigForSave(
      existingConfig,
      panes,
      PANES_FILE,
      FIXED_NOW
    );

    expect(config.projectRoot).toBe('/sample/projects/custom-root');
    expect(config.projectName).toBe('Custom Root');
    expect(config.panes).toEqual(panes);
    expect(config.settings).toEqual(existingConfig.settings);
    expect(config.controlPaneId).toBe('%10');
    expect(config.controlPaneSize).toBe(42);
    expect(config.welcomePaneId).toBe('%11');
    expect(config.extraField).toBe('preserve-me');
    expect(config.lastUpdated).toBe('2026-03-29T12:34:56.000Z');
    expect(config.sidebarProjects).toEqual([
      {
        projectRoot: '/sample/projects/custom-root',
        projectName: 'Custom Root',
      },
      {
        projectRoot: '/sample/projects/sidebar-fixture',
        projectName: 'sidebar-fixture',
      },
      {
        projectRoot: '/sample/projects/pane-fixture',
        projectName: 'pane-fixture',
      },
    ]);
  });
});
