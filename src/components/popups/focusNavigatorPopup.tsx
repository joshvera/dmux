#!/usr/bin/env node

import React, { Fragment, useMemo, useState } from 'react';
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
}

export type FocusNavigatorPopupResult =
  | {
      kind: 'pane';
      action: 'view' | 'close' | 'merge' | 'menu';
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
    }
  | {
      kind: 'pane';
      paneId: string;
      projectRoot: string;
      groupLabel: string;
      label: string;
      detail: string;
      attention: boolean;
    }
  | {
      kind: 'project';
      action: 'new-agent' | 'terminal' | 'reopen';
      projectRoot: string;
      groupLabel: string;
      label: string;
      detail: string;
    };

function buildRows(data: FocusNavigatorPopupData): FocusNavigatorRow[] {
  const rows: FocusNavigatorRow[] = [
    {
      kind: 'focus',
      label: 'Exit focus mode',
    },
  ];

  const groups = groupPanesByProject(
    data.panes,
    data.projectRoot,
    data.projectName,
    data.sidebarProjects
  );

  for (const group of groups) {
    for (const entry of group.panes) {
      const pane = entry.pane;
      const detailParts: string[] = [];
      if (pane.hidden) detailParts.push('hidden');
      if (pane.agent) detailParts.push(pane.agent);
      if (pane.branchName) detailParts.push(pane.branchName);
      else detailParts.push(pane.slug);

      rows.push({
        kind: 'pane',
        paneId: pane.id,
        projectRoot: group.projectRoot,
        groupLabel: group.projectName,
        label: getPaneDisplayName(pane),
        detail: detailParts.join(' | '),
        attention: pane.needsAttention === true,
      });
    }

    rows.push(
      {
        kind: 'project',
        action: 'new-agent',
        projectRoot: group.projectRoot,
        groupLabel: group.projectName,
        label: 'New agent',
        detail: `Create a worktree in ${group.projectName}`,
      },
      {
        kind: 'project',
        action: 'terminal',
        projectRoot: group.projectRoot,
        groupLabel: group.projectName,
        label: 'New terminal',
        detail: `Open a shell in ${group.projectName}`,
      },
      {
        kind: 'project',
        action: 'reopen',
        projectRoot: group.projectRoot,
        groupLabel: group.projectName,
        label: 'Reopen worktree',
        detail: `Resume a closed branch in ${group.projectName}`,
      }
    );
  }

  return rows;
}

function findInitialIndex(
  rows: FocusNavigatorRow[],
  selectedPaneId?: string
): number {
  if (!selectedPaneId) {
    return Math.min(1, rows.length - 1);
  }

  const targetIndex = rows.findIndex(
    (row) => row.kind === 'pane' && row.paneId === selectedPaneId
  );
  return targetIndex >= 0 ? targetIndex : Math.min(1, rows.length - 1);
}

function getProjectRootForRow(row: FocusNavigatorRow): string | null {
  if (row.kind === 'pane' || row.kind === 'project') {
    return row.projectRoot;
  }
  return null;
}

export const FocusNavigatorPopupApp: React.FC<{
  resultFile: string;
  data: FocusNavigatorPopupData;
}> = ({ resultFile, data }) => {
  const { exit } = useApp();
  const rows = useMemo(() => buildRows(data), [data]);
  const [selectedIndex, setSelectedIndex] = useState(() =>
    findInitialIndex(rows, data.selectedPaneId)
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
      writeSuccessAndExit<FocusNavigatorPopupResult>(
        resultFile,
        {
          kind: 'project',
          action: row.action,
          projectRoot: row.projectRoot,
        },
        exit
      );
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
        { kind: 'pane', action: 'menu', paneId: selectedRow.paneId },
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

  let lastGroupLabel: string | null = null;

  return (
    <PopupWrapper resultFile={resultFile}>
      <PopupContainer footer="Enter switch/select | x close | g merge | m pane menu | n/t/r project actions | F exit focus | Esc cancel">
        {rows.map((row, index) => {
          const groupLabel =
            row.kind === 'focus'
              ? null
              : row.groupLabel;
          const showGroupLabel = groupLabel && groupLabel !== lastGroupLabel;
          if (groupLabel) {
            lastGroupLabel = groupLabel;
          }

          return (
            <Fragment key={`${row.kind}-${index}`}>
              {showGroupLabel ? (
                <Box marginTop={1}>
                  <Text bold color={POPUP_CONFIG.titleColor}>
                    {groupLabel}
                  </Text>
                </Box>
              ) : null}
              <Box width="100%">
                <Box flexGrow={1}>
                  <Text
                    color={selectedIndex === index ? POPUP_CONFIG.titleColor : 'white'}
                    bold={selectedIndex === index}
                  >
                    {selectedIndex === index ? '> ' : '  '}
                    {row.kind === 'project' ? '+ ' : ''}
                    {row.label}
                    {row.kind === 'pane' && row.attention ? ' [!]' : ''}
                  </Text>
                </Box>
                {'detail' in row ? (
                  <Text dimColor>
                    {row.detail}
                  </Text>
                ) : null}
              </Box>
            </Fragment>
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
