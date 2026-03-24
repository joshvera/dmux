#!/usr/bin/env node

import React, { useMemo, useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import fs from 'fs';
import { pathToFileURL } from 'url';
import type { DmuxPane, SidebarProject } from '../../types.js';
import { groupPanesByProject } from '../../utils/paneGrouping.js';
import { getPaneDisplayName } from '../../utils/paneTitle.js';
import {
  PopupContainer,
  PopupWrapper,
  writeSuccessAndExit,
} from './shared/index.js';
import { POPUP_CONFIG } from './config.js';

export interface FocusNavigatorPopupData {
  panes: DmuxPane[];
  sidebarProjects: SidebarProject[];
  projectRoot: string;
  projectName: string;
  selectedPaneId?: string;
  selectedProjectRoot?: string;
}

export type FocusNavigatorPopupResult =
  | {
      kind: 'pane';
      action: 'view' | 'close' | 'merge' | 'more';
      paneId: string;
    }
  | {
      kind: 'project';
      action: 'new-agent' | 'terminal' | 'reopen';
      projectRoot: string;
    }
  | {
      kind: 'focus';
      action: 'exit';
    };

type FocusNavigatorRow =
  | {
      kind: 'focus';
      label: string;
      detail: string;
    }
  | {
      kind: 'project';
      projectRoot: string;
      label: string;
      detail: string;
    }
  | {
      kind: 'pane';
      paneId: string;
      projectRoot: string;
      label: string;
      detail: string;
      attention: boolean;
    };

function formatPaneDetail(pane: DmuxPane): string {
  const detailParts: string[] = [];
  if (pane.hidden) detailParts.push('hidden');
  if (pane.agent) detailParts.push(pane.agent);
  if (pane.branchName) detailParts.push(pane.branchName);
  else detailParts.push(pane.slug);
  return detailParts.join(' | ');
}

function buildRows(data: FocusNavigatorPopupData): FocusNavigatorRow[] {
  const rows: FocusNavigatorRow[] = [
    {
      kind: 'focus',
      label: 'Exit focus mode',
      detail: 'Return to your previous presentation mode',
    },
  ];

  const groups = groupPanesByProject(
    data.panes,
    data.projectRoot,
    data.projectName,
    data.sidebarProjects
  );

  for (const group of groups) {
    rows.push({
      kind: 'project',
      projectRoot: group.projectRoot,
      label: group.projectName,
      detail:
        group.panes.length === 0
          ? 'No panes'
          : `${group.panes.length} pane${group.panes.length === 1 ? '' : 's'}`,
    });

    for (const entry of group.panes) {
      rows.push({
        kind: 'pane',
        paneId: entry.pane.id,
        projectRoot: group.projectRoot,
        label: getPaneDisplayName(entry.pane),
        detail: formatPaneDetail(entry.pane),
        attention: entry.pane.needsAttention === true,
      });
    }
  }

  return rows;
}

function findInitialIndex(
  rows: FocusNavigatorRow[],
  selectedPaneId?: string,
  selectedProjectRoot?: string
): number {
  if (selectedPaneId) {
    const paneIndex = rows.findIndex(
      (row) => row.kind === 'pane' && row.paneId === selectedPaneId
    );
    if (paneIndex >= 0) {
      return paneIndex;
    }
  }

  if (selectedProjectRoot) {
    const projectIndex = rows.findIndex(
      (row) => row.kind === 'project' && row.projectRoot === selectedProjectRoot
    );
    if (projectIndex >= 0) {
      return projectIndex;
    }
  }

  const firstActionableIndex = rows.findIndex((row) => row.kind !== 'focus');
  return firstActionableIndex >= 0 ? firstActionableIndex : 0;
}

function getProjectRootForRow(row: FocusNavigatorRow): string | null {
  if (row.kind === 'project' || row.kind === 'pane') {
    return row.projectRoot;
  }
  return null;
}

function getFooterForRow(row: FocusNavigatorRow | undefined): string {
  if (!row || row.kind === 'focus') {
    return 'Enter exit focus | Esc cancel';
  }

  if (row.kind === 'project') {
    return 'n new agent | t new terminal | r reopen | Esc cancel';
  }

  return 'Enter switch | x close | g merge | m more | n/t/r project actions | Esc cancel';
}

export const FocusNavigatorPopupApp: React.FC<{
  resultFile: string;
  data: FocusNavigatorPopupData;
}> = ({ resultFile, data }) => {
  const { exit } = useApp();
  const rows = useMemo(() => buildRows(data), [data]);
  const [selectedIndex, setSelectedIndex] = useState(() =>
    findInitialIndex(rows, data.selectedPaneId, data.selectedProjectRoot)
  );
  const selectedRow = rows[selectedIndex];

  const submitRow = (row: FocusNavigatorRow) => {
    if (row.kind === 'focus') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'focus', action: 'exit' },
        exit
      );
      return;
    }

    if (row.kind === 'project') {
      return;
    }

    writeSuccessAndExit<FocusNavigatorPopupResult>(
      resultFile,
      {
        kind: 'pane',
        action: 'view',
        paneId: row.paneId,
      },
      exit
    );
  };

  useInput((input, key) => {
    if (rows.length === 0) {
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((current) => (current <= 0 ? rows.length - 1 : current - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((current) => (current >= rows.length - 1 ? 0 : current + 1));
      return;
    }

    if (key.return) {
      submitRow(rows[selectedIndex]);
      return;
    }

    if (input === 'F') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'focus', action: 'exit' },
        exit
      );
      return;
    }

    if (selectedRow?.kind === 'pane' && input === 'x') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'pane', action: 'close', paneId: selectedRow.paneId },
        exit
      );
      return;
    }

    if (selectedRow?.kind === 'pane' && input === 'g') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'pane', action: 'merge', paneId: selectedRow.paneId },
        exit
      );
      return;
    }

    if (selectedRow?.kind === 'pane' && input === 'm') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'pane', action: 'more', paneId: selectedRow.paneId },
        exit
      );
      return;
    }

    const projectRoot = selectedRow ? getProjectRootForRow(selectedRow) : null;
    if (!projectRoot) {
      return;
    }

    if (input === 'n') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'project', action: 'new-agent', projectRoot },
        exit
      );
      return;
    }

    if (input === 't') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'project', action: 'terminal', projectRoot },
        exit
      );
      return;
    }

    if (input === 'r') {
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        { kind: 'project', action: 'reopen', projectRoot },
        exit
      );
    }
  });

  return (
    <PopupWrapper resultFile={resultFile}>
      <PopupContainer footer={getFooterForRow(selectedRow)}>
        {rows.map((row, index) => {
          const isSelected = selectedIndex === index;
          const labelColor = isSelected ? POPUP_CONFIG.titleColor : 'white';
          const prefix = isSelected ? '> ' : '  ';

          if (row.kind === 'focus') {
            return (
              <Box key={`focus-${index}`} marginBottom={1}>
                <Box flexGrow={1}>
                  <Text color={labelColor} bold={isSelected}>
                    {prefix}
                    {row.label}
                  </Text>
                </Box>
                <Text dimColor>{row.detail}</Text>
              </Box>
            );
          }

          if (row.kind === 'project') {
            return (
              <Box key={`project-${row.projectRoot}`} marginTop={1} width="100%">
                <Box flexGrow={1}>
                  <Text color={labelColor} bold>
                    {prefix}
                    {row.label}
                  </Text>
                </Box>
                <Text dimColor>{row.detail}</Text>
              </Box>
            );
          }

          return (
            <Box key={`pane-${row.paneId}`} marginLeft={2} width="100%">
              <Box flexGrow={1}>
                <Text color={labelColor} bold={isSelected}>
                  {prefix}
                  {row.label}
                  {row.attention ? ' [!]' : ''}
                </Text>
              </Box>
              <Text dimColor>{row.detail}</Text>
            </Box>
          );
        })}
      </PopupContainer>
    </PopupWrapper>
  );
};

function main() {
  const resultFile = process.argv[2];
  const dataFile = process.argv[3];

  if (!resultFile || !dataFile) {
    console.error('Error: Result file and data file are required');
    process.exit(1);
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(dataFile, 'utf-8')
    ) as FocusNavigatorPopupData;

    render(<FocusNavigatorPopupApp resultFile={resultFile} data={data} />);
  } catch (error) {
    console.error('Failed to read focus navigator popup data:', error);
    process.exit(1);
  }
}

const entryPointHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryPointHref) {
  main();
}
