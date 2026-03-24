import { useEffect, useRef, useState } from "react"
import path from "path"
import { useInput } from "ink"
import type {
  DmuxPane,
  PresentationMode,
  SidebarProject,
} from "../types.js"
import type { TrackProjectActivity } from "../types/activity.js"
import { StateManager } from "../shared/StateManager.js"
import { TmuxService } from "../services/TmuxService.js"
import {
  STATUS_MESSAGE_DURATION_SHORT,
  STATUS_MESSAGE_DURATION_LONG,
  ANIMATION_DELAY,
} from "../constants/timing.js"
import {
  isPaneAction,
  type PaneMenuActionId,
  PaneAction,
  TOGGLE_PANE_VISIBILITY_ACTION,
} from "../actions/index.js"
import { getMainBranch } from "../utils/git.js"
import {
  getResumableBranches,
  type ResumableBranchCandidate,
} from "../utils/resumeBranches.js"
import { enforceControlPaneSize } from "../utils/tmux.js"
import { SIDEBAR_WIDTH } from "../utils/layoutManager.js"
import { suggestCommand } from "../utils/commands.js"
import type { PopupManager } from "../services/PopupManager.js"
import { getPaneProjectName, getPaneProjectRoot } from "../utils/paneProject.js"
import { getPaneDisplayName } from "../utils/paneTitle.js"
import {
  buildProjectActionLayout,
  getProjectActionByIndex,
  type ProjectActionItem,
} from "../utils/projectActions.js"
import { createShellPane, getNextDmuxId } from "../utils/shellPaneDetection.js"
import type { AgentName } from "../utils/agentLaunch.js"
import {
  getBulkVisibilityAction,
  getProjectVisibilityAction,
  partitionPanesByProject,
} from "../utils/paneVisibility.js"
import {
  applyBulkVisibilityToggle,
  applyPaneVisibilityToggle,
  applyProjectVisibilityToggle,
} from "../utils/paneVisibilityMutations.js"
import { buildFilesOnlyCommand } from "../utils/dmuxCommand.js"
import {
  addSidebarProject,
  hasSidebarProject,
  removeSidebarProject,
  sameSidebarProjectRoot,
} from "../utils/sidebarProjects.js"
import {
  drainRemotePaneActions,
  getCurrentTmuxSessionName,
  type RemotePaneActionShortcut,
} from "../utils/remotePaneActions.js"
import {
  getPresentationTargetPane,
  resolvePresentationMode,
} from "../utils/presentationMode.js"
import { SETTING_DEFINITIONS } from "../utils/settingsManager.js"
import type { DmuxSettings } from "../types.js"

// Type for the action system returned by useActionSystem hook
interface ActionSystem {
  actionState: any
  executeAction: (actionId: any, pane: DmuxPane, params?: any) => Promise<void>
  executeCallback: (callback: (() => Promise<any>) | null, options?: { showProgress?: boolean; progressMessage?: string }) => Promise<void>
  clearDialog: (dialogType: any) => void
  clearStatus: () => void
  setActionState: (state: any) => void
}

type PersistentPresentationMode = Exclude<PresentationMode, "focus">

type FocusNavigatorResult =
  | {
      kind: "pane"
      action: "view" | "close" | "merge" | "more"
      paneId: string
    }
  | {
      kind: "project"
      action: "new-agent" | "terminal" | "reopen"
      projectRoot: string
    }
  | {
      kind: "focus"
      action: "exit"
    }

type PendingPaneActivation = {
  paneId: string
  dmuxPaneId: string
  expectedIndex: number
  mode: "focus" | "single-pane"
}

interface UseInputHandlingParams {
  // State
  panes: DmuxPane[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  isCreatingPane: boolean
  setIsCreatingPane: (value: boolean) => void
  runningCommand: boolean
  isUpdating: boolean
  isLoading: boolean
  ignoreInput: boolean
  isDevMode: boolean
  quitConfirmMode: boolean
  setQuitConfirmMode: (value: boolean) => void

  // Dialog state
  showCommandPrompt: "test" | "dev" | null
  setShowCommandPrompt: (value: "test" | "dev" | null) => void
  commandInput: string
  setCommandInput: (value: string) => void
  showFileCopyPrompt: boolean
  setShowFileCopyPrompt: (value: boolean) => void
  currentCommandType: "test" | "dev" | null
  setCurrentCommandType: (value: "test" | "dev" | null) => void

  // Inline settings dialog state
  showInlineSettings: boolean
  setShowInlineSettings: (value: boolean) => void
  inlineSettingsIndex: number
  setInlineSettingsIndex: (value: number) => void
  inlineSettingsMode: 'list' | 'edit' | 'scope'
  setInlineSettingsMode: (value: 'list' | 'edit' | 'scope') => void
  inlineSettingsEditingKey: keyof import("../types.js").DmuxSettings | undefined
  setInlineSettingsEditingKey: (value: keyof import("../types.js").DmuxSettings | undefined) => void
  inlineSettingsEditingValueIndex: number
  setInlineSettingsEditingValueIndex: (value: number) => void
  inlineSettingsScopeIndex: number
  setInlineSettingsScopeIndex: (value: number) => void
  resetInlineSettings: () => void

  // Settings
  projectSettings: any
  saveSettings: (settings: any) => Promise<void>
  settingsManager: any

  // Services
  popupManager: PopupManager
  actionSystem: ActionSystem
  controlPaneId: string | undefined
  trackProjectActivity: TrackProjectActivity
  presentationMode: PresentationMode
  popupsSupported: boolean

  // Callbacks
  setStatusMessage: (message: string) => void
  copyNonGitFiles: (worktreePath: string, sourceProjectRoot?: string) => Promise<void>
  runCommandInternal: (type: "test" | "dev", pane: DmuxPane) => Promise<void>
  handlePaneCreationWithAgent: (prompt: string, targetProjectRoot?: string) => Promise<DmuxPane[]>
  handleCreateChildWorktree: (pane: DmuxPane) => Promise<DmuxPane[]>
  handleReopenWorktree: (
    candidate: ResumableBranchCandidate,
    targetProjectRoot?: string
  ) => Promise<DmuxPane | null>
  setDevSourceFromPane: (pane: DmuxPane) => Promise<void>
  savePanes: (panes: DmuxPane[]) => Promise<void>
  sidebarProjects: SidebarProject[]
  saveSidebarProjects: (projects: SidebarProject[]) => Promise<SidebarProject[]>
  loadPanes: () => Promise<void>
  cleanExit: () => void

  // Agent info
  availableAgents: AgentName[]
  panesFile: string

  // Project info
  projectRoot: string
  projectActionItems: ProjectActionItem[]

  // Navigation
  findCardInDirection: (currentIndex: number, direction: "up" | "down" | "left" | "right") => number | null
}

/**
 * Hook that handles all keyboard input for the TUI
 * Extracted from DmuxApp.tsx to reduce component complexity
 */
export function useInputHandling(params: UseInputHandlingParams) {
  const {
    panes,
    selectedIndex,
    setSelectedIndex,
    isCreatingPane,
    setIsCreatingPane,
    runningCommand,
    isUpdating,
    isLoading,
    ignoreInput,
    isDevMode,
    quitConfirmMode,
    setQuitConfirmMode,
    showCommandPrompt,
    setShowCommandPrompt,
    commandInput,
    setCommandInput,
    showFileCopyPrompt,
    setShowFileCopyPrompt,
    currentCommandType,
    setCurrentCommandType,
    showInlineSettings,
    setShowInlineSettings,
    inlineSettingsIndex,
    setInlineSettingsIndex,
    inlineSettingsMode,
    setInlineSettingsMode,
    inlineSettingsEditingKey,
    setInlineSettingsEditingKey,
    inlineSettingsEditingValueIndex,
    setInlineSettingsEditingValueIndex,
    inlineSettingsScopeIndex,
    setInlineSettingsScopeIndex,
    resetInlineSettings,
    projectSettings,
    saveSettings,
    settingsManager,
    popupManager,
    actionSystem,
    controlPaneId,
    trackProjectActivity,
    presentationMode,
    popupsSupported,
    setStatusMessage,
    copyNonGitFiles,
    runCommandInternal,
    handlePaneCreationWithAgent,
    handleCreateChildWorktree,
    handleReopenWorktree,
    setDevSourceFromPane,
    savePanes,
    sidebarProjects,
    saveSidebarProjects,
    loadPanes,
    cleanExit,
    availableAgents,
    panesFile,
    projectRoot,
    projectActionItems,
    findCardInDirection,
  } = params

  const layoutRefreshDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const quitConfirmResetRef = useRef<NodeJS.Timeout | null>(null)
  const effectivePresentationMode = resolvePresentationMode(
    !popupsSupported && presentationMode === "focus"
      ? "grid"
      : presentationMode
  )
  const lastPersistentModeRef = useRef<PersistentPresentationMode>(
    effectivePresentationMode === "focus" ? "grid" : effectivePresentationMode
  )
  const focusScopeRef = useRef<"global" | "project">(
    typeof settingsManager?.getEffectiveScope === "function"
      && settingsManager.getEffectiveScope("presentationMode") === "project"
      ? "project"
      : "global"
  )
  const presentationSyncKeyRef = useRef("")
  const pendingPaneActivationRef = useRef<PendingPaneActivation | null>(null)
  const [pendingPaneActivationVersion, setPendingPaneActivationVersion] = useState(0)
  const paneVisibilitySignature = panes
    .map((pane) => `${pane.id}:${pane.hidden ? "1" : "0"}`)
    .join("|")

  useEffect(() => {
    return () => {
      if (layoutRefreshDebounceRef.current) {
        clearTimeout(layoutRefreshDebounceRef.current)
        layoutRefreshDebounceRef.current = null
      }
      if (quitConfirmResetRef.current) {
        clearTimeout(quitConfirmResetRef.current)
        quitConfirmResetRef.current = null
      }
    }
  }, [])

  const queueLayoutRefresh = () => {
    if (!controlPaneId || effectivePresentationMode === "focus") {
      return
    }

    if (layoutRefreshDebounceRef.current) {
      clearTimeout(layoutRefreshDebounceRef.current)
    }

    layoutRefreshDebounceRef.current = setTimeout(async () => {
      layoutRefreshDebounceRef.current = null
      try {
        await enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, { forceLayout: true })
      } catch (error: any) {
        setStatusMessage(`Setting saved but layout refresh failed: ${error?.message || String(error)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
    }, 250)
  }

  const clearQuitConfirmMode = () => {
    if (quitConfirmResetRef.current) {
      clearTimeout(quitConfirmResetRef.current)
      quitConfirmResetRef.current = null
    }
    setQuitConfirmMode(false)
  }

  const armQuitConfirmMode = () => {
    if (quitConfirmResetRef.current) {
      clearTimeout(quitConfirmResetRef.current)
    }
    setQuitConfirmMode(true)
    quitConfirmResetRef.current = setTimeout(() => {
      quitConfirmResetRef.current = null
      setQuitConfirmMode(false)
    }, 3000)
  }

  const detachOrExit = async () => {
    clearQuitConfirmMode()

    if (!process.env.TMUX) {
      cleanExit()
      return
    }

    try {
      await TmuxService.getInstance().detachCurrentClient()
    } catch (error: any) {
      setStatusMessage(
        `Failed to detach from dmux session: ${error?.message || String(error)}`
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  const enterDetachConfirmMode = async () => {
    clearQuitConfirmMode()

    try {
      await TmuxService.getInstance().enterDetachConfirmMode()
    } catch (error: any) {
      setStatusMessage(
        `Failed to arm detach confirmation: ${error?.message || String(error)}`
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  useEffect(() => {
    if (effectivePresentationMode !== "focus") {
      lastPersistentModeRef.current = effectivePresentationMode
    }
  }, [effectivePresentationMode])

  const getPresentationScope = (): "global" | "project" => {
    if (
      typeof settingsManager?.getEffectiveScope === "function"
      && settingsManager.getEffectiveScope("presentationMode") === "project"
    ) {
      return "project"
    }
    return "global"
  }

  const getPresentationPane = (preferredPane?: DmuxPane): DmuxPane | undefined =>
    preferredPane || getPresentationTargetPane(panes, selectedIndex)

  const queueCreatedPaneActivation = (
    created: DmuxPane | DmuxPane[] | null
  ) => {
    if (
      effectivePresentationMode !== "focus"
      && effectivePresentationMode !== "single-pane"
    ) {
      return
    }

    const createdPanes = Array.isArray(created)
      ? created
      : created
        ? [created]
        : []
    const targetPane = createdPanes[0]
    if (!targetPane) {
      return
    }

    pendingPaneActivationRef.current = {
      paneId: targetPane.paneId,
      dmuxPaneId: targetPane.id,
      expectedIndex: panes.length,
      mode: effectivePresentationMode,
    }
    setPendingPaneActivationVersion((version) => version + 1)
  }

  const handleCreateAgentPane = async (targetProjectRoot: string): Promise<DmuxPane[]> => {
    const promptValue = await popupManager.launchNewPanePopup(targetProjectRoot)
    if (!promptValue) {
      return []
    }

    return await handlePaneCreationWithAgent(promptValue, targetProjectRoot)
  }

  const openBlankProjectActions = async (targetProjectRoot: string) => {
    const action = await popupManager.launchBlankProjectActionsPopup(
      path.basename(targetProjectRoot),
      targetProjectRoot
    )
    if (!action) {
      return
    }

    if (action === "new-agent") {
      queueCreatedPaneActivation(
        await handleCreateAgentPane(targetProjectRoot)
      )
      return
    }

    if (action === "terminal") {
      queueCreatedPaneActivation(
        await handleCreateTerminalPane(targetProjectRoot)
      )
      return
    }

    queueCreatedPaneActivation(
      await reopenClosedWorktreesInProject(targetProjectRoot)
    )
  }

  const handleCreateTerminalPane = async (targetProjectRoot: string): Promise<DmuxPane | null> => {
    try {
      setIsCreatingPane(true)
      setStatusMessage("Creating terminal pane...")

      const tmuxService = TmuxService.getInstance()
      const newPaneId = await tmuxService.splitPane({
        cwd: targetProjectRoot,
        preserveZoom: effectivePresentationMode === "focus",
      })

      // Wait for pane creation to settle
      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DELAY))

      // Persist shell pane immediately with project metadata so grouping is stable.
      const shellPane = await createShellPane(
        newPaneId,
        getNextDmuxId(panes)
      )
      shellPane.projectRoot = targetProjectRoot
      await savePanes([...panes, shellPane])

      setIsCreatingPane(false)
      setStatusMessage("Terminal pane created")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)

      // Force a reload to ensure tmux metadata and pane IDs are in sync
      await loadPanes()
      return shellPane
    } catch (error: any) {
      setStatusMessage(`Failed to create terminal pane: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return null
    } finally {
      setIsCreatingPane(false)
    }
  }

  const selectProjectAction = (
    targetProjectRoot: string,
    projectsToRender: SidebarProject[] = sidebarProjects
  ) => {
    const actionLayout = buildProjectActionLayout(
      panes,
      projectsToRender,
      projectRoot,
      path.basename(projectRoot)
    )
    const selectedAction = actionLayout.actionItems.find(
      (action) =>
        action.kind === "new-agent" &&
        sameSidebarProjectRoot(action.projectRoot, targetProjectRoot)
    )
    if (selectedAction) {
      setSelectedIndex(selectedAction.index)
    }
  }

  const openTerminalInWorktree = async (selectedPane: DmuxPane): Promise<DmuxPane | null> => {
    if (!selectedPane.worktreePath) {
      setStatusMessage("Cannot open terminal: this pane has no worktree")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return null
    }

    const targetProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)

    try {
      setIsCreatingPane(true)
      setStatusMessage(`Opening terminal in ${getPaneDisplayName(selectedPane)}...`)

      const tmuxService = TmuxService.getInstance()
      const newPaneId = await tmuxService.splitPane({
        cwd: selectedPane.worktreePath,
        preserveZoom: effectivePresentationMode === "focus",
      })

      // Wait for pane creation to settle
      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DELAY))

      const shellPane = await createShellPane(
        newPaneId,
        getNextDmuxId(panes)
      )
      shellPane.projectRoot = targetProjectRoot
      await savePanes([...panes, shellPane])

      setStatusMessage(`Opened terminal in ${getPaneDisplayName(selectedPane)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)

      // Force a reload to ensure tmux metadata and pane IDs are in sync
      await loadPanes()
      return shellPane
    } catch (error: any) {
      setStatusMessage(`Failed to open terminal in worktree: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return null
    } finally {
      setIsCreatingPane(false)
    }
  }

  const openFileBrowserInWorktree = async (selectedPane: DmuxPane): Promise<DmuxPane | null> => {
    if (!selectedPane.worktreePath) {
      setStatusMessage("Cannot open file browser: this pane has no worktree")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return null
    }

    const existingBrowserPane = panes.find((pane) =>
      pane.browserPath === selectedPane.worktreePath && !pane.hidden
    )

    if (existingBrowserPane) {
      try {
        await TmuxService.getInstance().selectPane(
          existingBrowserPane.paneId,
          effectivePresentationMode === "focus"
            ? { preserveZoom: true }
            : undefined
        )
        setStatusMessage(`File browser already open for ${getPaneDisplayName(selectedPane)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } catch (error: any) {
        setStatusMessage(`Failed to focus file browser: ${error?.message || String(error)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
      return existingBrowserPane
    }

    const targetProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)
    const targetProjectName = path.basename(targetProjectRoot)

    try {
      setIsCreatingPane(true)
      setStatusMessage(`Opening file browser for ${getPaneDisplayName(selectedPane)}...`)

      const tmuxService = TmuxService.getInstance()
      const newPaneId = await tmuxService.splitPane({
        cwd: selectedPane.worktreePath,
        command: buildFilesOnlyCommand(),
        preserveZoom: effectivePresentationMode === "focus",
      })

      await new Promise((resolve) => setTimeout(resolve, ANIMATION_DELAY))

      const slugBase = `files-${path.basename(selectedPane.worktreePath)}`
      let slug = slugBase
      let suffix = 2
      while (panes.some((pane) => pane.slug === slug)) {
        slug = `${slugBase}-${suffix}`
        suffix += 1
      }

      const browserPane: DmuxPane = {
        id: `dmux-${getNextDmuxId(panes)}`,
        slug,
        prompt: "",
        paneId: newPaneId,
        projectRoot: targetProjectRoot,
        projectName: targetProjectName,
        type: "shell",
        shellType: "fb",
        browserPath: selectedPane.worktreePath,
      }

      await tmuxService.setPaneTitle(newPaneId, slug)
      await savePanes([...panes, browserPane])
      await loadPanes()

      setStatusMessage(`Opened file browser for ${getPaneDisplayName(selectedPane)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return browserPane
    } catch (error: any) {
      setStatusMessage(`Failed to open file browser: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return null
    } finally {
      setIsCreatingPane(false)
    }
  }

  const handleAddProjectToSidebar = async () => {
    const selectedAction = getProjectActionByIndex(projectActionItems, selectedIndex)
    const selectedPane = selectedIndex < panes.length ? panes[selectedIndex] : undefined
    const defaultProjectPath = selectedPane
      ? getPaneProjectRoot(selectedPane, projectRoot)
      : (selectedAction?.projectRoot || projectRoot)

    const requestedProjectPath = await popupManager.launchProjectSelectPopup(
      defaultProjectPath,
      defaultProjectPath
    )

    if (!requestedProjectPath) {
      return
    }

    try {
      const { resolveProjectRootFromPath } = await import("../utils/projectRoot.js")
      const resolved = resolveProjectRootFromPath(requestedProjectPath, projectRoot)
      const nextProjects = addSidebarProject(sidebarProjects, resolved)

      if (nextProjects === sidebarProjects) {
        selectProjectAction(resolved.projectRoot)
        setStatusMessage(`${resolved.projectName} is already in the sidebar`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        return
      }

      const savedProjects = await saveSidebarProjects(nextProjects)
      selectProjectAction(resolved.projectRoot, savedProjects)
      setStatusMessage(`Added ${resolved.projectName} to the sidebar`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      const {
        createEmptyGitProject,
        inspectProjectCreationTarget,
      } = await import("../utils/projectRoot.js")
      const target = inspectProjectCreationTarget(requestedProjectPath, projectRoot)

      if (target.state !== "missing" && target.state !== "empty_directory") {
        const message = target.state === "directory_not_empty"
          ? `Directory is not a git repository and is not empty: ${target.absolutePath}. New projects can only be created in a missing or empty directory.`
          : (error?.message || "Invalid project path")
        setStatusMessage(message)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        return
      }

      const confirmMessage = target.state === "missing"
        ? `This project does not exist yet:\n${target.absolutePath}\n\nCreate a new empty git repository here?`
        : `This directory is not a git repository:\n${target.absolutePath}\n\nInitialize a new empty git repository here?`
      const shouldCreateProject = await popupManager.launchConfirmPopup(
        "Create Project",
        confirmMessage,
        "Create Project",
        "Cancel",
        projectRoot
      )

      if (!shouldCreateProject) {
        return
      }

      try {
        setStatusMessage(`Creating ${path.basename(target.absolutePath) || "project"}...`)
        const createdProject = createEmptyGitProject(requestedProjectPath, projectRoot)
        const nextProjects = addSidebarProject(sidebarProjects, createdProject)

        if (nextProjects === sidebarProjects) {
          selectProjectAction(createdProject.projectRoot)
          setStatusMessage(`${createdProject.projectName} is already in the sidebar`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
          return
        }

        const savedProjects = await saveSidebarProjects(nextProjects)
        selectProjectAction(createdProject.projectRoot, savedProjects)
        setStatusMessage(`Created ${createdProject.projectName} and added it to the sidebar`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } catch (creationError: any) {
        setStatusMessage(creationError?.message || "Failed to create project")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
    }
  }

  const handleRemoveProjectFromSidebar = async (targetProjectRoot: string) => {
    if (sameSidebarProjectRoot(targetProjectRoot, projectRoot)) {
      setStatusMessage("The session project cannot be removed from the sidebar")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const projectHasPanes = panes.some((pane) =>
      sameSidebarProjectRoot(getPaneProjectRoot(pane, projectRoot), targetProjectRoot)
    )
    if (projectHasPanes) {
      setStatusMessage("Close this project's panes before removing it from the sidebar")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return
    }

    if (!hasSidebarProject(sidebarProjects, targetProjectRoot)) {
      setStatusMessage("Project is not in the sidebar")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const updatedProjects = removeSidebarProject(sidebarProjects, targetProjectRoot)
    const savedProjects = await saveSidebarProjects(updatedProjects)
    selectProjectAction(projectRoot, savedProjects)
    setStatusMessage(`Removed ${path.basename(targetProjectRoot)} from the sidebar`)
    setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
  }

  const getActiveProjectRoot = (): string => {
    const selectedPane = selectedIndex < panes.length ? panes[selectedIndex] : undefined
    if (selectedPane) {
      return getPaneProjectRoot(selectedPane, projectRoot)
    }

    const selectedAction = getProjectActionByIndex(projectActionItems, selectedIndex)
    return selectedAction?.projectRoot || projectRoot
  }

  const launchHooksAuthoringSession = async (targetProjectRoot?: string) => {
    const hooksProjectRoot = targetProjectRoot || getActiveProjectRoot()
    const { initializeHooksDirectory } = await import("../utils/hooks.js")
    initializeHooksDirectory(hooksProjectRoot)

    const prompt =
      "I would like to create or edit my dmux hooks in .dmux-hooks. Please read AGENTS.md or CLAUDE.md first, then ask me what I want to create or modify."
    queueCreatedPaneActivation(
      await handlePaneCreationWithAgent(prompt, hooksProjectRoot)
    )
  }

  const refreshPaneLayout = async () => {
    if (!controlPaneId || effectivePresentationMode === "focus") {
      return
    }

    await enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, {
      forceLayout: true,
      suppressLayoutLogs: true,
    })
  }

  const getPaneShowTarget = async (excludedPaneId?: string): Promise<string | null> => {
    const visiblePaneId = panes.find(
      (pane) => !pane.hidden && pane.paneId !== excludedPaneId
    )?.paneId
    if (visiblePaneId) {
      return visiblePaneId
    }

    if (controlPaneId) {
      return controlPaneId
    }

    try {
      return await TmuxService.getInstance().getCurrentPaneId()
    } catch {
      return null
    }
  }

  const ensurePaneVisible = async (
    targetPane: DmuxPane,
    options: { preserveZoom?: boolean } = {}
  ): Promise<boolean> => {
    if (!targetPane.hidden) {
      return false
    }

    const targetPaneId = await getPaneShowTarget(targetPane.paneId)
    if (!targetPaneId) {
      throw new Error("No target pane is available to show this pane")
    }

    await TmuxService.getInstance().joinPaneToTarget(
      targetPane.paneId,
      targetPaneId,
      true,
      options.preserveZoom === true
    )

    await savePanes(
      panes.map((pane) =>
        pane.id === targetPane.id ? { ...pane, hidden: false } : pane
      )
    )

    if (!options.preserveZoom) {
      await refreshPaneLayout()
    }
    await loadPanes()
    return true
  }

  const revealAllHiddenPanes = async () => {
    const hiddenPanes = panes.filter((pane) => pane.hidden)
    if (hiddenPanes.length === 0) {
      return
    }

    const tmuxService = TmuxService.getInstance()
    for (const pane of hiddenPanes) {
      const targetPaneId = await getPaneShowTarget(pane.paneId)
      if (!targetPaneId) {
        throw new Error("No target pane is available to show hidden panes")
      }
      await tmuxService.joinPaneToTarget(pane.paneId, targetPaneId)
    }

    await savePanes(panes.map((pane) => ({ ...pane, hidden: false })))
    await refreshPaneLayout()
    await loadPanes()
  }

  const isolatePane = async (
    targetPane: DmuxPane,
    options: {
      activatePane?: boolean
      suppressStatus?: boolean
    } = {}
  ) => {
    const tmuxService = TmuxService.getInstance()
    const resolvedTargetPane = panes.find((pane) => pane.id === targetPane.id) || targetPane
    let changed = false

    if (resolvedTargetPane.hidden) {
      const targetPaneId = await getPaneShowTarget(resolvedTargetPane.paneId)
      if (!targetPaneId) {
        throw new Error("No target pane is available to show this pane")
      }
      await tmuxService.joinPaneToTarget(resolvedTargetPane.paneId, targetPaneId)
      changed = true
    }

    const otherVisiblePanes = panes.filter(
      (pane) => pane.id !== resolvedTargetPane.id && !pane.hidden
    )
    for (const pane of otherVisiblePanes) {
      await tmuxService.breakPaneToWindow(pane.paneId, `dmux-hidden-${pane.id}`)
      changed = true
    }

    if (changed) {
      await savePanes(
        panes.map((pane) => {
          if (pane.id === resolvedTargetPane.id) {
            return { ...pane, hidden: false }
          }
          if (!pane.hidden) {
            return { ...pane, hidden: true }
          }
          return pane
        })
      )
      await refreshPaneLayout()
      await loadPanes()
    }

    const targetIndex = panes.findIndex((pane) => pane.id === resolvedTargetPane.id)
    if (targetIndex >= 0) {
      setSelectedIndex(targetIndex)
    }

    if (options.activatePane) {
      await tmuxService.selectPane(resolvedTargetPane.paneId)
    }

    if (!options.suppressStatus) {
      setStatusMessage(`Viewing ${getPaneDisplayName(resolvedTargetPane)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    }
  }

  const focusPane = async (
    targetPane: DmuxPane,
    options: { suppressStatus?: boolean } = {}
  ) => {
    if (!popupsSupported) {
      throw new Error("Focus mode requires tmux popup support")
    }

    const resolvedTargetPane = panes.find((pane) => pane.id === targetPane.id) || targetPane
    if (resolvedTargetPane.hidden) {
      await ensurePaneVisible(resolvedTargetPane, { preserveZoom: true })
    }

    const targetIndex = panes.findIndex((pane) => pane.id === resolvedTargetPane.id)
    if (targetIndex >= 0) {
      setSelectedIndex(targetIndex)
    }

    const tmuxService = TmuxService.getInstance()
    const alreadyZoomed = await tmuxService.isWindowZoomed(resolvedTargetPane.paneId)

    await tmuxService.selectPane(
      resolvedTargetPane.paneId,
      alreadyZoomed ? { preserveZoom: true } : undefined
    )
    await tmuxService.setPaneZoom(resolvedTargetPane.paneId, true)

    if (!options.suppressStatus) {
      setStatusMessage(`Focused ${getPaneDisplayName(resolvedTargetPane)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    }
  }

  useEffect(() => {
    const pendingActivation = pendingPaneActivationRef.current
    if (!pendingActivation) {
      return
    }

    if (isCreatingPane) {
      return
    }

    if (effectivePresentationMode !== pendingActivation.mode) {
      pendingPaneActivationRef.current = null
      return
    }

    const targetPane =
      panes.find((pane) => pane.id === pendingActivation.dmuxPaneId)
      || panes.find((pane) => pane.paneId === pendingActivation.paneId)
      || panes[pendingActivation.expectedIndex]

    if (!targetPane) {
      return
    }

    pendingPaneActivationRef.current = null
    presentationSyncKeyRef.current = ""

    const activatePendingPane = async () => {
      if (pendingActivation.mode === "focus") {
        await focusPane(targetPane, { suppressStatus: true })
        return
      }

      await isolatePane(targetPane, {
        activatePane: true,
        suppressStatus: true,
      })
    }

    void activatePendingPane().catch((error: any) => {
      setStatusMessage(`Failed to activate created pane: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    })
  }, [
    effectivePresentationMode,
    focusPane,
    isolatePane,
    isCreatingPane,
    panes,
    pendingPaneActivationVersion,
    setStatusMessage,
  ])

  const applyPresentationModeChange = async (
    nextMode: PresentationMode,
    options: {
      persist?: boolean
      scope?: "global" | "project"
      preferredPane?: DmuxPane
      activateTargetPane?: boolean
    } = {}
  ): Promise<boolean> => {
    const resolvedNextMode = resolvePresentationMode(nextMode)
    const tmuxService = TmuxService.getInstance()
    const targetPane = getPresentationPane(options.preferredPane)
    const scope = options.scope || getPresentationScope()

    if (resolvedNextMode === "focus") {
      if (!popupsSupported) {
        setStatusMessage("Focus mode requires tmux 3.2+ popups")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        return false
      }

      if (effectivePresentationMode !== "focus") {
        lastPersistentModeRef.current = effectivePresentationMode
      }
      focusScopeRef.current = scope

      if (options.persist) {
        settingsManager.updateSetting("presentationMode", resolvedNextMode, scope)
      }

      if (!targetPane) {
        setStatusMessage("Focus mode needs at least one pane")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        return false
      }

      await focusPane(targetPane)
      presentationSyncKeyRef.current = ""
      return true
    }

    lastPersistentModeRef.current = resolvedNextMode

    if (options.persist) {
      settingsManager.updateSetting("presentationMode", resolvedNextMode, scope)
    }

    if (effectivePresentationMode === "focus") {
      try {
        const zoomTargetPaneId = targetPane?.paneId || controlPaneId
        if (zoomTargetPaneId) {
          await tmuxService.setPaneZoom(zoomTargetPaneId, false)
        }
      } catch {
        // Ignore - tmux may already have unzoomed the window
      }
    }

    if (resolvedNextMode === "grid") {
      await revealAllHiddenPanes()
      if (controlPaneId) {
        await tmuxService.selectPane(controlPaneId)
      }
      presentationSyncKeyRef.current = ""
      return true
    }

    if (!targetPane) {
      if (controlPaneId) {
        await tmuxService.selectPane(controlPaneId)
      }
      presentationSyncKeyRef.current = ""
      return true
    }

    await isolatePane(targetPane, {
      activatePane: options.activateTargetPane === true,
      suppressStatus: options.activateTargetPane !== true,
    })

    if (options.activateTargetPane !== true && controlPaneId) {
      await tmuxService.selectPane(controlPaneId)
    }

    presentationSyncKeyRef.current = ""
    return true
  }

  useEffect(() => {
    if (isLoading) {
      return
    }

    const targetPane = getPresentationPane()
    const syncKey = `${effectivePresentationMode}:${targetPane?.id || "none"}:${paneVisibilitySignature}`
    if (presentationSyncKeyRef.current === syncKey) {
      return
    }
    presentationSyncKeyRef.current = syncKey

    if (!targetPane) {
      return
    }

    if (effectivePresentationMode === "single-pane") {
      const visiblePaneCount = panes.filter((pane) => !pane.hidden).length
      const selectedPane = panes[selectedIndex]
      if (visiblePaneCount > 1 || targetPane.hidden || selectedPane?.hidden) {
        void isolatePane(targetPane, { suppressStatus: true })
      }
      return
    }

    if (effectivePresentationMode === "focus") {
      void focusPane(targetPane, { suppressStatus: true }).catch(() => {
        // Best effort only.
      })
    }
  }, [
    effectivePresentationMode,
    isLoading,
    paneVisibilitySignature,
    panes,
    selectedIndex,
  ])

  const togglePaneVisibility = async (selectedPane: DmuxPane) => {
    try {
      setIsCreatingPane(true)
      setStatusMessage(
        selectedPane.hidden
          ? `Showing ${getPaneDisplayName(selectedPane)}...`
          : `Hiding ${getPaneDisplayName(selectedPane)}...`
      )

      const result = await applyPaneVisibilityToggle(
        {
          panes,
          tmuxService: TmuxService.getInstance(),
          getPaneShowTarget,
          savePanes,
          loadPanes,
          refreshPaneLayout,
        },
        selectedPane
      )

      if (result.hidden) {
        const fallbackPane = getPresentationTargetPane(
          result.updatedPanes,
          selectedIndex
        )

        if (fallbackPane && fallbackPane.id !== selectedPane.id) {
          const fallbackIndex = result.updatedPanes.findIndex(
            (pane) => pane.id === fallbackPane.id
          )

          if (fallbackIndex >= 0) {
            setSelectedIndex(fallbackIndex)
          }

          presentationSyncKeyRef.current = ""

          if (effectivePresentationMode === "focus") {
            const tmuxService = TmuxService.getInstance()
            const alreadyZoomed = await tmuxService.isWindowZoomed(
              fallbackPane.paneId
            )
            await tmuxService.selectPane(
              fallbackPane.paneId,
              alreadyZoomed ? { preserveZoom: true } : undefined
            )
            await tmuxService.setPaneZoom(fallbackPane.paneId, true)
          }
        }
      }

      setStatusMessage(
        result.hidden
          ? `Hid ${getPaneDisplayName(selectedPane)}`
          : `Showing ${getPaneDisplayName(selectedPane)}`
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to toggle pane visibility: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const toggleOtherPanesVisibility = async (selectedPane: DmuxPane) => {
    const action = getBulkVisibilityAction(panes, selectedPane)
    if (!action) {
      setStatusMessage("No other panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const targetPanes = panes.filter((pane) =>
      pane.id !== selectedPane.id
        && (action === "hide-others" ? !pane.hidden : pane.hidden)
    )

    if (targetPanes.length === 0) {
      setStatusMessage("No other panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    try {
      setIsCreatingPane(true)
      setStatusMessage(action === "hide-others" ? "Hiding other panes..." : "Showing other panes...")

      const result = await applyBulkVisibilityToggle(
        {
          panes,
          tmuxService: TmuxService.getInstance(),
          getPaneShowTarget,
          savePanes,
          loadPanes,
          refreshPaneLayout,
        },
        selectedPane
      )
      if (!result) {
        setStatusMessage("No other panes to toggle")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        return
      }

      setStatusMessage(
        result.action === "hide-others"
          ? `Hid ${result.targetPanes.length} other pane${result.targetPanes.length === 1 ? "" : "s"}`
          : `Showed ${result.targetPanes.length} other pane${result.targetPanes.length === 1 ? "" : "s"}`
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to toggle other panes: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const toggleProjectPanesVisibility = async (
    targetProjectRoot: string = getActiveProjectRoot()
  ) => {
    const action = getProjectVisibilityAction(panes, targetProjectRoot, projectRoot)

    if (!action) {
      setStatusMessage("No project panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const { projectPanes, otherPanes } = partitionPanesByProject(
      panes,
      targetProjectRoot,
      projectRoot
    )

    if (projectPanes.length === 0) {
      setStatusMessage("No project panes to toggle")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    const projectName = getPaneProjectName(
      projectPanes[0],
      projectRoot
    )
    const panesToShow = action === "focus-project"
      ? projectPanes.filter((pane) => pane.hidden)
      : panes.filter((pane) => pane.hidden)
    const panesToHide = action === "focus-project"
      ? otherPanes.filter((pane) => !pane.hidden)
      : []

    try {
      setIsCreatingPane(true)
      setStatusMessage(
        action === "focus-project"
          ? `Showing ${projectName} panes...`
          : "Showing all panes..."
      )

      const result = await applyProjectVisibilityToggle(
        {
          panes,
          tmuxService: TmuxService.getInstance(),
          getPaneShowTarget,
          savePanes,
          loadPanes,
          refreshPaneLayout,
        },
        targetProjectRoot,
        projectRoot
      )
      if (!result) {
        setStatusMessage("No project panes to toggle")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        return
      }

      setStatusMessage(
        result.action === "focus-project"
          ? result.panesToHide.length > 0
            ? `Showing only ${result.projectName} panes`
            : `Showed ${result.projectName} panes`
          : "Showed all panes"
      )
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
    } catch (error: any) {
      setStatusMessage(`Failed to toggle project panes: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    } finally {
      setIsCreatingPane(false)
    }
  }

  const executeViewAction = async (selectedPane: DmuxPane) => {
    try {
      if (effectivePresentationMode === "single-pane") {
        await isolatePane(selectedPane, { activatePane: true })
        return
      }

      if (effectivePresentationMode === "focus") {
        await focusPane(selectedPane)
        return
      }

      await actionSystem.executeAction(PaneAction.VIEW, selectedPane)
    } catch (error: any) {
      setStatusMessage(`Failed to view pane: ${error?.message || String(error)}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
    }
  }

  const openFocusNavigator = async (selectedPane: DmuxPane) => {
    const result = await popupManager.launchFocusNavigatorPopup(
      {
        panes,
        sidebarProjects,
        projectRoot,
        projectName: path.basename(projectRoot),
        selectedPaneId: selectedPane.id,
        selectedProjectRoot: getPaneProjectRoot(selectedPane, projectRoot),
      },
      getPaneProjectRoot(selectedPane, projectRoot)
    ) as FocusNavigatorResult | null

    if (!result) {
      return
    }

    if (result.kind === "focus" && result.action === "exit") {
      await applyPresentationModeChange(lastPersistentModeRef.current, {
        persist: true,
        scope: focusScopeRef.current,
        preferredPane: selectedPane,
      })
      return
    }

    if (result.kind === "project") {
      if (result.action === "new-agent") {
        queueCreatedPaneActivation(
          await handleCreateAgentPane(result.projectRoot)
        )
      } else if (result.action === "terminal") {
        queueCreatedPaneActivation(
          await handleCreateTerminalPane(result.projectRoot)
        )
      } else if (result.action === "reopen") {
        queueCreatedPaneActivation(
          await reopenClosedWorktreesInProject(result.projectRoot)
        )
      }
      return
    }

    const targetPane = panes.find((pane) => pane.id === result.paneId)
    if (!targetPane) {
      setStatusMessage("That pane is no longer available")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return
    }

    if (result.action === "view") {
      await executeViewAction(targetPane)
      return
    }

    if (result.action === "more") {
      const actionId = await popupManager.launchFocusActionSheetPopup(
        targetPane,
        panes
      )
      if (!actionId) {
        return
      }

      await executePaneMenuAction(targetPane, actionId)
      return
    }

    if (result.action === "close") {
      await actionSystem.executeAction(PaneAction.CLOSE, targetPane, {
        mainBranch: getMainBranch(),
      })
      return
    }

    if (result.action === "merge") {
      await actionSystem.executeAction(PaneAction.MERGE, targetPane, {
        mainBranch: getMainBranch(),
      })
    }
  }

  const executePaneMenuAction = async (
    pane: DmuxPane,
    actionId: PaneMenuActionId
  ) => {
    if (actionId === TOGGLE_PANE_VISIBILITY_ACTION) {
      await togglePaneVisibility(pane)
      return
    }

    if (actionId === "hide-others" || actionId === "show-others") {
      await toggleOtherPanesVisibility(pane)
      return
    }

    if (actionId === "focus-project" || actionId === "show-all") {
      await toggleProjectPanesVisibility(getPaneProjectRoot(pane, projectRoot))
      return
    }

    if (actionId === PaneAction.SET_SOURCE) {
      await setDevSourceFromPane(pane)
      return
    }

    if (actionId === PaneAction.VIEW) {
      await executeViewAction(pane)
      return
    }

    if (actionId === PaneAction.ATTACH_AGENT) {
      queueCreatedPaneActivation(await attachAgentsToPane(pane))
      return
    }

    if (actionId === PaneAction.CREATE_CHILD_WORKTREE) {
      queueCreatedPaneActivation(await handleCreateChildWorktree(pane))
      return
    }

    if (actionId === PaneAction.OPEN_TERMINAL_IN_WORKTREE) {
      queueCreatedPaneActivation(await openTerminalInWorktree(pane))
      return
    }

    if (actionId === PaneAction.OPEN_FILE_BROWSER) {
      queueCreatedPaneActivation(await openFileBrowserInWorktree(pane))
      return
    }

    if (!isPaneAction(actionId)) {
      setStatusMessage(`Unknown menu action: ${actionId}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return
    }

    await actionSystem.executeAction(actionId, pane, {
      mainBranch: getMainBranch(),
    })
  }

  const openPaneMenu = async (
    pane: DmuxPane,
    options: { anchorToPane?: boolean; forceStandardMenu?: boolean } = {}
  ) => {
    if (
      effectivePresentationMode === "focus"
      && options.anchorToPane
      && !options.forceStandardMenu
    ) {
      await openFocusNavigator(pane)
      return
    }

    const actionId = await popupManager.launchKebabMenuPopup(
      pane,
      panes,
      options
    )
    if (!actionId) {
      return
    }

    await executePaneMenuAction(pane, actionId)
  }

  const attachAgentsToPane = async (selectedPane: DmuxPane): Promise<DmuxPane[]> => {
    if (!selectedPane.worktreePath) {
      setStatusMessage("Cannot attach agent: this pane has no worktree")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return []
    }

    const targetProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)

    // Warn if agent is actively working
    if (selectedPane.agentStatus === "working") {
      const confirmed = await popupManager.launchConfirmPopup(
        "Agent Active",
        `Agent in "${getPaneDisplayName(selectedPane)}" is currently working. Attach another agent anyway?`,
        "Attach",
        "Cancel",
        targetProjectRoot
      )
      if (!confirmed) return []
    }

    let selectedAgents: AgentName[] = []
    if (availableAgents.length === 0) {
      setStatusMessage("No agents available")
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      return []
    } else if (availableAgents.length === 1) {
      selectedAgents = [availableAgents[0]]
    } else {
      const agents = await popupManager.launchAgentChoicePopup(targetProjectRoot)
      if (agents === null) {
        return []
      }
      if (agents.length === 0) {
        setStatusMessage("Select at least one agent")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        return []
      }
      selectedAgents = agents
    }

    // Prompt input
    const promptValue = await popupManager.launchNewPanePopup(targetProjectRoot)
    if (!promptValue) return []

    try {
      setIsCreatingPane(true)
      setStatusMessage(
        selectedAgents.length > 1
          ? `Attaching ${selectedAgents.length} agents...`
          : "Attaching agent..."
      )

      const { attachAgentToWorktree } = await import("../utils/attachAgent.js")
      const createdPanes: DmuxPane[] = []
      const failedAgents: AgentName[] = []

      for (const agent of selectedAgents) {
        try {
          const result = await attachAgentToWorktree({
            targetPane: selectedPane,
            prompt: promptValue,
            agent,
            existingPanes: [...panes, ...createdPanes],
            sessionProjectRoot: projectRoot,
            sessionConfigPath: panesFile,
          })
          createdPanes.push(result.pane)
        } catch {
          failedAgents.push(agent)
        }
      }

      if (createdPanes.length > 0) {
        const updatedPanes = [...panes, ...createdPanes]
        await savePanes(updatedPanes)
        await loadPanes()
      }

      if (failedAgents.length === 0) {
        setStatusMessage(
          `Attached ${createdPanes.length} agent${createdPanes.length === 1 ? "" : "s"} to ${getPaneDisplayName(selectedPane)}`
        )
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } else if (createdPanes.length === 0) {
        setStatusMessage(
          `Failed to attach agents: ${failedAgents.join(", ")}`
        )
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      } else {
        setStatusMessage(
          `Attached ${createdPanes.length}/${selectedAgents.length} agents to ${getPaneDisplayName(selectedPane)} (${failedAgents.length} failed)`
        )
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
      return createdPanes
    } catch (error: any) {
      setStatusMessage(`Failed to attach agent: ${error.message}`)
      setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      return []
    } finally {
      setIsCreatingPane(false)
    }
  }

  const isInteractionBlocked = () =>
    ignoreInput
    || isCreatingPane
    || runningCommand
    || isUpdating
    || isLoading
    || showFileCopyPrompt
    || showCommandPrompt !== null

  const reopenClosedWorktreesInProject = async (
    targetProjectRoot: string
  ): Promise<DmuxPane | null> => {
    const activeSlugs = panes
      .filter((pane) => sameSidebarProjectRoot(getPaneProjectRoot(pane, projectRoot), targetProjectRoot))
      .map((pane) => pane.slug)
    const popupState = {
      includeWorktrees: true,
      includeLocalBranches: true,
      includeRemoteBranches: false,
      remoteLoaded: false,
      filterQuery: "",
    }
    const resumableBranches = await trackProjectActivity(
      async () => getResumableBranches(targetProjectRoot, activeSlugs, {
        includeRemoteBranches: false,
      }),
      targetProjectRoot
    )

    const result = await popupManager.launchReopenWorktreePopup(
      resumableBranches,
      targetProjectRoot,
      popupState,
      activeSlugs
    )
    if (!result) {
      return null
    }

    return await handleReopenWorktree({
      branchName: result.candidate.branchName,
      slug: result.candidate.slug,
      path: result.candidate.path,
      lastModified: result.candidate.lastModified
        ? new Date(result.candidate.lastModified)
        : undefined,
      hasUncommittedChanges: result.candidate.hasUncommittedChanges,
      hasWorktree: result.candidate.hasWorktree,
      hasLocalBranch: result.candidate.hasLocalBranch,
      hasRemoteBranch: result.candidate.hasRemoteBranch,
      isRemote: result.candidate.isRemote,
    }, targetProjectRoot)
  }

  const executePaneShortcut = async (
    shortcut: RemotePaneActionShortcut,
    selectedPane: DmuxPane,
    options: { anchorMenuToPane?: boolean } = {}
  ) => {
    switch (shortcut) {
      case "a":
        queueCreatedPaneActivation(await attachAgentsToPane(selectedPane))
        return
      case "b":
        queueCreatedPaneActivation(await handleCreateChildWorktree(selectedPane))
        return
      case "f":
        queueCreatedPaneActivation(await openFileBrowserInWorktree(selectedPane))
        return
      case "A":
        queueCreatedPaneActivation(await openTerminalInWorktree(selectedPane))
        return
      case "m":
        await openPaneMenu(selectedPane, {
          anchorToPane: options.anchorMenuToPane,
        })
        return
      case "h":
        await togglePaneVisibility(selectedPane)
        return
      case "H":
        await toggleOtherPanesVisibility(selectedPane)
        return
      case "P":
        await toggleProjectPanesVisibility(getPaneProjectRoot(selectedPane, projectRoot))
        return
      case "r":
        queueCreatedPaneActivation(
          await reopenClosedWorktreesInProject(getPaneProjectRoot(selectedPane, projectRoot))
        )
        return
      case "S":
        if (!isDevMode) {
          setStatusMessage("Source switching is only available in DEV mode")
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
          return
        }
        await setDevSourceFromPane(selectedPane)
        return
      case "j":
        StateManager.getInstance().setDebugMessage(
          `Jumping to pane: ${getPaneDisplayName(selectedPane)}`
        )
        setTimeout(() => StateManager.getInstance().setDebugMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        await executeViewAction(selectedPane)
        return
      case "x":
        StateManager.getInstance().setDebugMessage(
          `Closing pane: ${getPaneDisplayName(selectedPane)}`
        )
        setTimeout(() => StateManager.getInstance().setDebugMessage(""), STATUS_MESSAGE_DURATION_SHORT)
        await actionSystem.executeAction(PaneAction.CLOSE, selectedPane)
        return
    }
  }

  const remoteDrainRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const drainQueuedRemoteActions = async () => {
      const sessionName = getCurrentTmuxSessionName()
      if (!sessionName) {
        return
      }

      const queuedActions = await drainRemotePaneActions(sessionName)
      if (queuedActions.length === 0) {
        return
      }

      for (const action of queuedActions) {
        if (isInteractionBlocked()) {
          setStatusMessage(`dmux is busy; ignored remote pane action ${action.shortcut}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
          continue
        }

        const paneIndex = panes.findIndex((pane) => pane.paneId === action.targetPaneId)
        if (paneIndex === -1) {
          if (action.shortcut === "m") {
            if (panes.length === 0) {
              await openBlankProjectActions(projectRoot)
            } else {
              // Open settings from the sidebar via Alt+Shift+M
              const result = await popupManager.launchSettingsPopup(async () => {
                await popupManager.launchHooksPopup(async () => {
                  await launchHooksAuthoringSession()
                }, getActiveProjectRoot())
              }, getActiveProjectRoot())
              if (!result && !popupsSupported) {
                setShowInlineSettings(true)
              } else if (result) {
                try {
                  const updates = Array.isArray((result as any).updates)
                    ? (result as any).updates
                    : [result]
                  for (const update of updates) {
                    if (!update || typeof update.key !== "string" || (update.scope !== "global" && update.scope !== "project")) continue
                    if (update.key === "presentationMode") {
                      await applyPresentationModeChange(resolvePresentationMode(update.value), { persist: true, scope: update.scope, activateTargetPane: false })
                    } else {
                      settingsManager.updateSetting(update.key as keyof DmuxSettings, update.value, update.scope)
                    }
                  }
                  setStatusMessage("Settings updated")
                  setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
                } catch (error: any) {
                  setStatusMessage(`Failed to save setting: ${error?.message || String(error)}`)
                  setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
                }
              }
            }
            continue
          }

          setStatusMessage(`Focused pane is not managed by dmux: ${action.targetPaneId}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
          continue
        }

        setSelectedIndex(paneIndex)
        await executePaneShortcut(action.shortcut, panes[paneIndex], {
          anchorMenuToPane: true,
        })
      }
    }

    const queueDrain = () => {
      remoteDrainRef.current = remoteDrainRef.current
        .then(drainQueuedRemoteActions)
        .catch((error: any) => {
          setStatusMessage(`Failed to process remote pane action: ${error?.message || String(error)}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        })
      return remoteDrainRef.current
    }

    const handleRemoteSignal = () => {
      void queueDrain()
    }

    void queueDrain()
    process.on("dmux-external-command-signal" as any, handleRemoteSignal)

    return () => {
      process.off("dmux-external-command-signal" as any, handleRemoteSignal)
    }
  }, [
    actionSystem,
    handleCreateChildWorktree,
    handleReopenWorktree,
    ignoreInput,
    isCreatingPane,
    isDevMode,
    isLoading,
    isUpdating,
    panes,
    popupManager,
    projectRoot,
    runCommandInternal,
    runningCommand,
    setDevSourceFromPane,
    setSelectedIndex,
    setStatusMessage,
    showCommandPrompt,
    showFileCopyPrompt,
  ])

  useInput(async (input: string, key: any) => {
    // Ignore input temporarily after popup operations (prevents buffered keys from being processed)
    if (ignoreInput) {
      return
    }

    // Handle Ctrl+C for quit confirmation (must be first, before any other checks)
    if (key.ctrl && input === "c") {
      if (process.env.TMUX) {
        await enterDetachConfirmMode()
      } else {
        if (quitConfirmMode) {
          await detachOrExit()
        } else {
          armQuitConfirmMode()
        }
      }
      return
    }

    if (isCreatingPane || runningCommand || isUpdating || isLoading) {
      // Disable input while performing operations or loading
      return
    }

    // Handle quit confirm mode - ESC cancels it
    if (quitConfirmMode) {
      if (key.escape) {
        clearQuitConfirmMode()
        return
      }
      // Allow other inputs to continue (don't return early)
    }

    if (showFileCopyPrompt) {
      if (input === "y" || input === "Y") {
        setShowFileCopyPrompt(false)
        const selectedPane = panes[selectedIndex]
        if (selectedPane && selectedPane.worktreePath && currentCommandType) {
          const paneProjectRoot = getPaneProjectRoot(selectedPane, projectRoot)
          await copyNonGitFiles(selectedPane.worktreePath, paneProjectRoot)

          // Mark as not first run and continue with command
          const newSettings = {
            ...projectSettings,
            [currentCommandType === "test" ? "firstTestRun" : "firstDevRun"]:
              true,
          }
          await saveSettings(newSettings)

          // Now run the actual command
          await runCommandInternal(currentCommandType, selectedPane)
        }
        setCurrentCommandType(null)
      } else if (input === "n" || input === "N" || key.escape) {
        setShowFileCopyPrompt(false)
        const selectedPane = panes[selectedIndex]
        if (selectedPane && currentCommandType) {
          // Mark as not first run and continue without copying
          const newSettings = {
            ...projectSettings,
            [currentCommandType === "test" ? "firstTestRun" : "firstDevRun"]:
              true,
          }
          await saveSettings(newSettings)

          // Now run the actual command
          await runCommandInternal(currentCommandType, selectedPane)
        }
        setCurrentCommandType(null)
      }
      return
    }

    if (showCommandPrompt) {
      if (key.escape) {
        setShowCommandPrompt(null)
        setCommandInput("")
      } else if (key.return) {
        if (commandInput.trim() === "") {
          // If empty, suggest a default command based on package manager
          const suggested = await suggestCommand(showCommandPrompt)
          if (suggested) {
            setCommandInput(suggested)
          }
        } else {
          // User provided manual command
          const newSettings = {
            ...projectSettings,
            [showCommandPrompt === "test" ? "testCommand" : "devCommand"]:
              commandInput.trim(),
          }
          await saveSettings(newSettings)
          const selectedPane = panes[selectedIndex]
          if (selectedPane) {
            // Check if first run
            const isFirstRun =
              showCommandPrompt === "test"
                ? !projectSettings.firstTestRun
                : !projectSettings.firstDevRun
            if (isFirstRun) {
              setCurrentCommandType(showCommandPrompt)
              setShowCommandPrompt(null)
              setShowFileCopyPrompt(true)
            } else {
              await runCommandInternal(showCommandPrompt, selectedPane)
              setShowCommandPrompt(null)
              setCommandInput("")
            }
          } else {
            setShowCommandPrompt(null)
            setCommandInput("")
          }
        }
      }
      return
    }

    // Handle inline settings dialog input
    if (showInlineSettings) {
      if (key.escape) {
        if (inlineSettingsMode === 'list') {
          resetInlineSettings()
        } else {
          // Go back to list mode
          setInlineSettingsMode('list')
          setInlineSettingsEditingKey(undefined)
          setInlineSettingsEditingValueIndex(0)
          setInlineSettingsScopeIndex(0)
        }
      } else if (key.upArrow) {
        if (inlineSettingsMode === 'list') {
          setInlineSettingsIndex(Math.max(0, inlineSettingsIndex - 1))
        } else if (inlineSettingsMode === 'edit') {
          const currentDef = inlineSettingsEditingKey
            ? SETTING_DEFINITIONS.find(d => d.key === inlineSettingsEditingKey)
            : null
          if (currentDef?.type === 'boolean' || currentDef?.type === 'select') {
            setInlineSettingsEditingValueIndex(Math.max(0, inlineSettingsEditingValueIndex - 1))
          }
        } else if (inlineSettingsMode === 'scope') {
          setInlineSettingsScopeIndex(Math.max(0, inlineSettingsScopeIndex - 1))
        }
      } else if (key.downArrow) {
        if (inlineSettingsMode === 'list') {
          setInlineSettingsIndex(Math.min(SETTING_DEFINITIONS.length - 1, inlineSettingsIndex + 1))
        } else if (inlineSettingsMode === 'edit') {
          const currentDef = inlineSettingsEditingKey
            ? SETTING_DEFINITIONS.find(d => d.key === inlineSettingsEditingKey)
            : null
          if (currentDef && (currentDef.type === 'boolean' || currentDef.type === 'select')) {
            const maxIndex = currentDef.type === 'boolean' ? 1 : (currentDef.options?.length || 1) - 1
            setInlineSettingsEditingValueIndex(Math.min(maxIndex, inlineSettingsEditingValueIndex + 1))
          }
        } else if (inlineSettingsMode === 'scope') {
          setInlineSettingsScopeIndex(Math.min(1, inlineSettingsScopeIndex + 1))
        }
      } else if (key.return) {
        if (inlineSettingsMode === 'list') {
          const currentDef = SETTING_DEFINITIONS[inlineSettingsIndex]
          if (currentDef.type === 'action') {
            // Action settings (enabledAgents, etc.) not supported inline
            setStatusMessage(`${currentDef.label} requires popup support`)
            setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
            return
          }
          // Enter edit mode
          setInlineSettingsEditingKey(currentDef.key as keyof DmuxSettings)
          setInlineSettingsMode('edit')
          const currentValue = settingsManager.getSettings()[currentDef.key as keyof DmuxSettings]
          if (currentDef.type === 'boolean') {
            setInlineSettingsEditingValueIndex(currentValue ? 0 : 1)
          } else if (currentDef.type === 'select' && currentDef.options) {
            const optIndex = currentDef.options.findIndex(o => o.value === currentValue)
            setInlineSettingsEditingValueIndex(Math.max(0, optIndex))
          } else if (currentDef.type === 'text' || currentDef.type === 'number') {
            // Text/number not fully supported inline
            setStatusMessage(`${currentDef.label} requires popup support`)
            setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
            setInlineSettingsMode('list')
            setInlineSettingsEditingKey(undefined)
            return
          }
        } else if (inlineSettingsMode === 'edit') {
          // Go to scope selection
          setInlineSettingsMode('scope')
          setInlineSettingsScopeIndex(0)
        } else if (inlineSettingsMode === 'scope') {
          // Save the setting
          const currentDef = SETTING_DEFINITIONS.find(d => d.key === inlineSettingsEditingKey)
          if (currentDef && currentDef.type !== 'action') {
            const scope = inlineSettingsScopeIndex === 0 ? 'global' : 'project'
            let newValue: any
            if (currentDef.type === 'boolean') {
              newValue = inlineSettingsEditingValueIndex === 0
            } else if (currentDef.type === 'select' && currentDef.options) {
              newValue = currentDef.options[inlineSettingsEditingValueIndex]?.value || ''
            }

            try {
              if (currentDef.key === 'presentationMode') {
                await applyPresentationModeChange(
                  resolvePresentationMode(newValue),
                  { persist: true, scope, activateTargetPane: false }
                )
              } else {
                settingsManager.updateSetting(
                  currentDef.key as keyof DmuxSettings,
                  newValue,
                  scope as "global" | "project"
                )
              }
              setStatusMessage(`Setting saved (${scope})`)
              setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
            } catch (error: any) {
              setStatusMessage(`Failed to save setting: ${error?.message || String(error)}`)
              setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
            }

            // Return to list mode
            setInlineSettingsMode('list')
            setInlineSettingsEditingKey(undefined)
            setInlineSettingsEditingValueIndex(0)
            setInlineSettingsScopeIndex(0)
          }
        }
      }
      return
    }

    // Handle directional navigation with spatial awareness based on card grid layout
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      let targetIndex: number | null = null

      if (key.upArrow) {
        targetIndex = findCardInDirection(selectedIndex, "up")
      } else if (key.downArrow) {
        targetIndex = findCardInDirection(selectedIndex, "down")
      } else if (key.leftArrow) {
        targetIndex = findCardInDirection(selectedIndex, "left")
      } else if (key.rightArrow) {
        targetIndex = findCardInDirection(selectedIndex, "right")
      }

      if (targetIndex !== null) {
        setSelectedIndex(targetIndex)
      }
      return
    }

    if (
      selectedIndex < panes.length
      && ["a", "b", "f", "A", "m"].includes(input)
    ) {
      await executePaneShortcut(input as RemotePaneActionShortcut, panes[selectedIndex])
      return
    } else if (input === "s") {
      // Open settings popup, fall back to inline dialog if popups unavailable
      const result = await popupManager.launchSettingsPopup(async () => {
        // Launch hooks popup
        await popupManager.launchHooksPopup(async () => {
          await launchHooksAuthoringSession()
        }, getActiveProjectRoot())
      }, getActiveProjectRoot())
      if (!result && !popupsSupported) {
        setShowInlineSettings(true)
        return
      }
      if (result) {
        try {
          const updates = Array.isArray((result as any).updates)
            ? (result as any).updates
            : [result]

          let savedCount = 0
          let layoutBoundsUpdated = false
          let lastScope: "global" | "project" | null = null

          for (const update of updates) {
            if (
              !update
              || typeof update.key !== "string"
              || (update.scope !== "global" && update.scope !== "project")
            ) {
              continue
            }

            if (update.key === "presentationMode") {
              const saved = await applyPresentationModeChange(
                resolvePresentationMode(update.value),
                {
                  persist: true,
                  scope: update.scope,
                  activateTargetPane: false,
                }
              )
              if (!saved) {
                continue
              }
            } else {
              settingsManager.updateSetting(
                update.key as keyof import("../types.js").DmuxSettings,
                update.value,
                update.scope
              )
            }

            savedCount += 1
            lastScope = update.scope

            if (update.key === "minPaneWidth" || update.key === "maxPaneWidth") {
              layoutBoundsUpdated = true
            }
          }

          if (layoutBoundsUpdated) {
            queueLayoutRefresh()
          }

          if (savedCount > 0) {
            const statusMessage =
              savedCount === 1
                ? `Setting saved (${lastScope})`
                : `${savedCount} settings saved`
            setStatusMessage(statusMessage)
            setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
          }
        } catch (error: any) {
          setStatusMessage(`Failed to save setting: ${error?.message || String(error)}`)
          setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
        }
      }
    } else if (input === "l") {
      // Open logs popup
      await popupManager.launchLogsPopup(getActiveProjectRoot())
    } else if (input === "h") {
      if (selectedIndex < panes.length) {
        await executePaneShortcut("h", panes[selectedIndex])
      } else {
        setStatusMessage("Select a pane to toggle visibility")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      }
    } else if (input === "H") {
      if (selectedIndex < panes.length) {
        await executePaneShortcut("H", panes[selectedIndex])
      } else {
        setStatusMessage("Select a pane to toggle the others")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      }
    } else if (input === "P") {
      if (selectedIndex < panes.length) {
        await executePaneShortcut("P", panes[selectedIndex])
      } else {
        await toggleProjectPanesVisibility()
      }
    } else if (input === "?") {
      // Open keyboard shortcuts popup
      const shortcutsAction = await popupManager.launchShortcutsPopup(
        !!controlPaneId,
        getActiveProjectRoot()
      )
      if (shortcutsAction === "hooks") {
        await launchHooksAuthoringSession()
      }
    } else if (input === "L" && controlPaneId) {
      // Reset layout to sidebar configuration (Shift+L)
      try {
        await enforceControlPaneSize(controlPaneId, SIDEBAR_WIDTH, { forceLayout: true })
        setStatusMessage("Layout reset")
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_SHORT)
      } catch (error: any) {
        setStatusMessage(`Failed to reset layout: ${error?.message || String(error)}`)
        setTimeout(() => setStatusMessage(""), STATUS_MESSAGE_DURATION_LONG)
      }
    } else if (input === "T") {
      // Demo toasts (Shift+T) - cycles through different types
      const stateManager = StateManager.getInstance()
      const demos = [
        { msg: "Pane created successfully", severity: "success" as const },
        { msg: "Failed to merge: conflicts detected", severity: "error" as const },
        { msg: "Warning: API key not configured", severity: "warning" as const },
        { msg: "This is a longer informational message that will wrap to multiple lines if needed to demonstrate how toasts handle longer content", severity: "info" as const },
      ]
      // Queue all demo toasts
      demos.forEach(demo => stateManager.showToast(demo.msg, demo.severity))
    } else if (input === "q") {
      if (process.env.TMUX) {
        await enterDetachConfirmMode()
      } else {
        if (quitConfirmMode) {
          await detachOrExit()
        } else {
          armQuitConfirmMode()
        }
      }
      return
    } else if (isDevMode && input === "S" && selectedIndex < panes.length) {
      await executePaneShortcut("S", panes[selectedIndex])
      return
    } else if (input === "r") {
      queueCreatedPaneActivation(
        await reopenClosedWorktreesInProject(getActiveProjectRoot())
      )
      return
    } else if (
      !isLoading &&
      (
        input === "p" ||
        input === "N"
      )
    ) {
      // Add a project to the sidebar ([p], with Shift+N fallback)
      await handleAddProjectToSidebar()
      return
    } else if (!isLoading && input === "R") {
      await handleRemoveProjectFromSidebar(getActiveProjectRoot())
      return
    } else if (!isLoading && input === "n") {
      queueCreatedPaneActivation(
        await handleCreateAgentPane(getActiveProjectRoot())
      )
      return
    } else if (!isLoading && input === "t") {
      queueCreatedPaneActivation(
        await handleCreateTerminalPane(getActiveProjectRoot())
      )
      return
    } else if (
      !isLoading &&
      key.return &&
      !!getProjectActionByIndex(projectActionItems, selectedIndex)
    ) {
      const selectedAction = getProjectActionByIndex(projectActionItems, selectedIndex)!
      if (selectedAction.kind === "new-agent") {
        queueCreatedPaneActivation(
          await handleCreateAgentPane(selectedAction.projectRoot)
        )
      } else if (selectedAction.kind === "terminal") {
        queueCreatedPaneActivation(
          await handleCreateTerminalPane(selectedAction.projectRoot)
        )
      } else if (selectedAction.kind === "remove-project") {
        await handleRemoveProjectFromSidebar(selectedAction.projectRoot)
      }
      return
    } else if (
      selectedIndex < panes.length
      && (input === "j" || input === "x")
    ) {
      await executePaneShortcut(input as RemotePaneActionShortcut, panes[selectedIndex])
      return
    } else if (key.return && selectedIndex < panes.length) {
      // Open pane menu for selected pane
      await openPaneMenu(panes[selectedIndex])
      return
    }
  })
}
