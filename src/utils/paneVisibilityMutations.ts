import type { DmuxPane } from "../types.js"
import { getPaneProjectName } from "./paneProject.js"
import {
  getBulkVisibilityAction,
  getProjectVisibilityAction,
  partitionPanesByProject,
  type PaneBulkVisibilityAction,
  type PaneProjectVisibilityAction,
} from "./paneVisibility.js"

type PaneVisibilityTmuxService = {
  breakPaneToWindow: (paneId: string, windowName: string) => Promise<string>
  joinPaneToTarget: (
    sourcePaneId: string,
    targetPaneId: string,
    horizontal?: boolean,
    preserveZoom?: boolean
  ) => Promise<void>
}

export interface PaneVisibilityMutationDeps {
  panes: DmuxPane[]
  tmuxService: PaneVisibilityTmuxService
  getPaneShowTarget: (excludedPaneId?: string) => Promise<string | null>
  savePanes: (panes: DmuxPane[]) => Promise<void>
  loadPanes: () => Promise<void>
  refreshPaneLayout: () => Promise<void>
}

export interface PaneVisibilityToggleResult {
  updatedPanes: DmuxPane[]
  hidden: boolean
}

export interface BulkVisibilityToggleResult {
  action: PaneBulkVisibilityAction
  targetPanes: DmuxPane[]
  updatedPanes: DmuxPane[]
}

export interface ProjectVisibilityToggleResult {
  action: PaneProjectVisibilityAction
  projectName: string
  panesToShow: DmuxPane[]
  panesToHide: DmuxPane[]
  updatedPanes: DmuxPane[]
}

export async function applyPaneVisibilityToggle(
  deps: PaneVisibilityMutationDeps,
  selectedPane: DmuxPane
): Promise<PaneVisibilityToggleResult> {
  if (selectedPane.hidden) {
    const targetPaneId = await deps.getPaneShowTarget(selectedPane.paneId)
    if (!targetPaneId) {
      throw new Error("No target pane is available to show this pane")
    }
    await deps.tmuxService.joinPaneToTarget(selectedPane.paneId, targetPaneId)
  } else {
    await deps.tmuxService.breakPaneToWindow(
      selectedPane.paneId,
      `dmux-hidden-${selectedPane.id}`
    )
  }

  const updatedPanes = deps.panes.map((pane) =>
    pane.id === selectedPane.id
      ? { ...pane, hidden: !selectedPane.hidden }
      : pane
  )

  await deps.savePanes(updatedPanes)
  await deps.refreshPaneLayout()
  await deps.loadPanes()

  return {
    updatedPanes,
    hidden: !selectedPane.hidden,
  }
}

export async function applyBulkVisibilityToggle(
  deps: PaneVisibilityMutationDeps,
  selectedPane: DmuxPane
): Promise<BulkVisibilityToggleResult | null> {
  const action = getBulkVisibilityAction(deps.panes, selectedPane)
  if (!action) {
    return null
  }

  const targetPanes = deps.panes.filter((pane) =>
    pane.id !== selectedPane.id
      && (action === "hide-others" ? !pane.hidden : pane.hidden)
  )

  if (targetPanes.length === 0) {
    return null
  }

  const hideTargetPanes = action === "hide-others"

  for (const pane of targetPanes) {
    if (hideTargetPanes) {
      await deps.tmuxService.breakPaneToWindow(
        pane.paneId,
        `dmux-hidden-${pane.id}`
      )
      continue
    }

    const targetPaneId = await deps.getPaneShowTarget(pane.paneId)
    if (!targetPaneId) {
      throw new Error("No target pane is available to show hidden panes")
    }
    await deps.tmuxService.joinPaneToTarget(pane.paneId, targetPaneId)
  }

  const targetPaneIds = new Set(targetPanes.map((pane) => pane.id))
  const updatedPanes = deps.panes.map((pane) =>
    targetPaneIds.has(pane.id) ? { ...pane, hidden: hideTargetPanes } : pane
  )

  await deps.savePanes(updatedPanes)
  await deps.refreshPaneLayout()
  await deps.loadPanes()

  return {
    action,
    targetPanes,
    updatedPanes,
  }
}

export async function applyProjectVisibilityToggle(
  deps: PaneVisibilityMutationDeps,
  targetProjectRoot: string,
  fallbackProjectRoot: string
): Promise<ProjectVisibilityToggleResult | null> {
  const action = getProjectVisibilityAction(
    deps.panes,
    targetProjectRoot,
    fallbackProjectRoot
  )

  if (!action) {
    return null
  }

  const { projectPanes, otherPanes } = partitionPanesByProject(
    deps.panes,
    targetProjectRoot,
    fallbackProjectRoot
  )

  if (projectPanes.length === 0) {
    return null
  }

  const projectName = getPaneProjectName(projectPanes[0], fallbackProjectRoot)
  const panesToShow = action === "focus-project"
    ? projectPanes.filter((pane) => pane.hidden)
    : deps.panes.filter((pane) => pane.hidden)
  const panesToHide = action === "focus-project"
    ? otherPanes.filter((pane) => !pane.hidden)
    : []

  for (const pane of panesToShow) {
    const targetPaneId = await deps.getPaneShowTarget(pane.paneId)
    if (!targetPaneId) {
      throw new Error("No target pane is available to show hidden panes")
    }
    await deps.tmuxService.joinPaneToTarget(pane.paneId, targetPaneId)
  }

  for (const pane of panesToHide) {
    await deps.tmuxService.breakPaneToWindow(
      pane.paneId,
      `dmux-hidden-${pane.id}`
    )
  }

  const shownPaneIds = new Set(panesToShow.map((pane) => pane.id))
  const hiddenPaneIds = new Set(panesToHide.map((pane) => pane.id))

  const updatedPanes = deps.panes.map((pane) => {
    if (shownPaneIds.has(pane.id)) {
      return { ...pane, hidden: false }
    }
    if (hiddenPaneIds.has(pane.id)) {
      return { ...pane, hidden: true }
    }
    return pane
  })

  await deps.savePanes(updatedPanes)
  await deps.refreshPaneLayout()
  await deps.loadPanes()

  return {
    action,
    projectName,
    panesToShow,
    panesToHide,
    updatedPanes,
  }
}
