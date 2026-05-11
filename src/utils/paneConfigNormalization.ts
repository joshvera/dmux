import path from 'path';
import type { DmuxConfig, DmuxPane, SidebarProject } from '../types.js';
import { normalizeSidebarProjects } from './sidebarProjects.js';

type PersistedDmuxConfig = Partial<DmuxConfig> & Record<string, unknown>;

function isConfigObject(value: unknown): value is PersistedDmuxConfig {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getStringField(config: PersistedDmuxConfig, key: 'projectRoot' | 'projectName'): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getSidebarProjects(config: PersistedDmuxConfig): SidebarProject[] | undefined {
  return Array.isArray(config.sidebarProjects)
    ? config.sidebarProjects as SidebarProject[]
    : undefined;
}

export function normalizePaneConfigForSave(
  parsedConfig: unknown,
  panes: DmuxPane[],
  panesFile: string,
  now: Date = new Date()
): PersistedDmuxConfig {
  const fallbackProjectRoot = path.dirname(path.dirname(panesFile));
  const baseConfig = isConfigObject(parsedConfig) ? { ...parsedConfig } : {};
  const projectRoot = getStringField(baseConfig, 'projectRoot') || fallbackProjectRoot;
  const projectName = getStringField(baseConfig, 'projectName') || path.basename(projectRoot);

  return {
    ...baseConfig,
    panes,
    projectRoot,
    projectName,
    sidebarProjects: normalizeSidebarProjects(
      getSidebarProjects(baseConfig),
      panes,
      projectRoot,
      projectName
    ),
    lastUpdated: now.toISOString(),
  };
}
