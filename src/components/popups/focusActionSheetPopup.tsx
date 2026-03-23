#!/usr/bin/env node

import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { pathToFileURL } from 'url';
import type { PaneMenuAction, PaneMenuActionId } from '../../actions/types.js';
import { PaneAction } from '../../actions/types.js';
import { PopupContainer, PopupWrapper, writeSuccessAndExit } from './shared/index.js';
import { POPUP_CONFIG } from './config.js';

interface FocusActionSheetPopupProps {
  resultFile: string;
  paneName: string;
  actions: PaneMenuAction[];
  initialSelectedIndex?: number;
}

type ActionSection = {
  title: string;
  actions: PaneMenuAction[];
}

function getActionSectionTitle(actionId: PaneMenuActionId): string {
  switch (actionId) {
    case PaneAction.ATTACH_AGENT:
    case PaneAction.CREATE_CHILD_WORKTREE:
    case PaneAction.OPEN_TERMINAL_IN_WORKTREE:
    case PaneAction.OPEN_FILE_BROWSER:
      return 'Worktree';
    case 'toggle_visibility':
    case 'hide-others':
    case 'show-others':
    case 'focus-project':
    case 'show-all':
      return 'Visibility';
    default:
      return 'Utility';
  }
}

export function groupFocusActionSheetActions(
  actions: PaneMenuAction[]
): ActionSection[] {
  const titles = ['Worktree', 'Utility', 'Visibility'] as const;
  const sections = new Map<string, PaneMenuAction[]>(
    titles.map((title) => [title, []])
  );

  for (const action of actions) {
    const title = getActionSectionTitle(action.id);
    sections.get(title)!.push(action);
  }

  return titles
    .filter((title) => sections.get(title)!.length > 0)
    .map((title) => ({
      title,
      actions: sections.get(title)!,
    }));
}

export function getOrderedFocusActionSheetActions(
  actions: PaneMenuAction[]
): PaneMenuAction[] {
  return groupFocusActionSheetActions(actions).flatMap((section) => section.actions);
}

function isSubmitInput(input: string, key: { return?: boolean }): boolean {
  return key.return === true || input === '\r' || input === '\n';
}

export const FocusActionSheetPopupApp: React.FC<FocusActionSheetPopupProps> = ({
  resultFile,
  paneName,
  actions,
  initialSelectedIndex = 0,
}) => {
  const [selectedIndex, setSelectedIndex] = React.useState(initialSelectedIndex);
  const { exit } = useApp();
  const sections = React.useMemo(
    () => groupFocusActionSheetActions(actions),
    [actions]
  );
  const orderedActions = React.useMemo(
    () => getOrderedFocusActionSheetActions(actions),
    [actions]
  );

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(
        selectedIndex <= 0 ? orderedActions.length - 1 : selectedIndex - 1
      );
    } else if (key.downArrow) {
      setSelectedIndex(
        selectedIndex >= orderedActions.length - 1 ? 0 : selectedIndex + 1
      );
    } else if (isSubmitInput(input, key)) {
      const selectedAction = orderedActions[selectedIndex];
      writeSuccessAndExit(resultFile, selectedAction.id, exit);
    } else {
      const shortcutAction = orderedActions.find((action) => action.shortcut === input);
      if (shortcutAction) {
        writeSuccessAndExit(resultFile, shortcutAction.id, exit);
      }
    }
  });

  let runningIndex = 0;

  return (
    <PopupWrapper resultFile={resultFile}>
      <PopupContainer
        title={`Actions: ${paneName}`}
        footer="↑↓ navigate | Enter or hotkey select | Esc cancel"
      >
        {sections.map((section) => (
          <Box key={section.title} flexDirection="column" marginBottom={1}>
            <Text bold color={POPUP_CONFIG.titleColor}>
              {section.title}
            </Text>
            {section.actions.map((action) => {
              const index = runningIndex++;
              const isSelected = selectedIndex === index;
              return (
                <Box key={action.id} width="100%">
                  <Box flexGrow={1}>
                    <Text color={isSelected ? POPUP_CONFIG.titleColor : 'white'} bold={isSelected}>
                      {isSelected ? '> ' : '  '}
                      {action.label}
                    </Text>
                  </Box>
                  <Text dimColor>{action.description}</Text>
                  {action.shortcut ? (
                    <Text color="yellow"> [{action.shortcut}]</Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        ))}
      </PopupContainer>
    </PopupWrapper>
  );
};

function main() {
  const resultFile = process.argv[2];
  const paneName = process.argv[3];
  const actionsJson = process.argv[4];

  if (!resultFile || !paneName || !actionsJson) {
    console.error('Error: Result file, pane name, and actions JSON required');
    process.exit(1);
  }

  let actions: PaneMenuAction[];
  try {
    actions = JSON.parse(actionsJson);
  } catch {
    console.error('Error: Failed to parse actions JSON');
    process.exit(1);
  }

  render(
    <FocusActionSheetPopupApp
      resultFile={resultFile}
      paneName={paneName}
      actions={actions}
    />
  );
}

const entryPointHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryPointHref) {
  main();
}
