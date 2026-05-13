import type { DmuxPane } from '../types.js';
import {
  getProjectActionByIndex,
  type ProjectActionItem,
} from './projectActions.js';
import { getPaneProjectRoot } from './paneProject.js';
import { sameSidebarProjectRoot } from './sidebarProjects.js';

export function resolveControlPaneSelection(
  selectedIndex: number,
  panes: DmuxPane[],
  actionItems: ProjectActionItem[],
  fallbackProjectRoot: string
): number {
  if (getProjectActionByIndex(actionItems, selectedIndex)) {
    return selectedIndex;
  }

  const selectedPane = panes[selectedIndex];
  const targetProjectRoot = selectedPane
    ? getPaneProjectRoot(selectedPane, fallbackProjectRoot)
    : fallbackProjectRoot;

  const projectNewAgentAction = actionItems.find(
    (action) =>
      action.kind === 'new-agent' &&
      sameSidebarProjectRoot(action.projectRoot, targetProjectRoot)
  );
  if (projectNewAgentAction) {
    return projectNewAgentAction.index;
  }

  const firstNewAgentAction = actionItems.find(
    (action) => action.kind === 'new-agent'
  );
  if (firstNewAgentAction) {
    return firstNewAgentAction.index;
  }

  return actionItems[0]?.index ?? selectedIndex;
}

export interface ControlPaneFocusSelection {
  selectedIndex: number;
  selectionPending: boolean;
}

export function resolveControlPaneFocusSelection(
  selectedIndex: number,
  panes: DmuxPane[],
  actionItems: ProjectActionItem[],
  fallbackProjectRoot: string,
  wasControlFocused: boolean
): ControlPaneFocusSelection {
  if (wasControlFocused) {
    return { selectedIndex, selectionPending: false };
  }

  const resolvedIndex = resolveControlPaneSelection(
    selectedIndex,
    panes,
    actionItems,
    fallbackProjectRoot
  );

  return {
    selectedIndex: resolvedIndex,
    selectionPending: resolvedIndex !== selectedIndex,
  };
}
