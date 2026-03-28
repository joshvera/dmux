import React from "react"
import { Text } from "ink"
import { render } from "ink-testing-library"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useInputHandling } from "../src/hooks/useInputHandling.js"
import { TmuxService } from "../src/services/TmuxService.js"
import { SETTING_DEFINITIONS } from "../src/utils/settingsManager.js"
import type { DmuxPane } from "../src/types.js"

vi.mock("../src/utils/tmux.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/tmux.js")>("../src/utils/tmux.js")
  return {
    ...actual,
    enforceControlPaneSize: vi.fn(async () => {}),
  }
})

vi.mock("../src/utils/remotePaneActions.js", () => ({
  drainRemotePaneActions: vi.fn(async () => []),
  getCurrentTmuxSessionName: vi.fn(() => null),
}))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const defaultAgentDefinition = SETTING_DEFINITIONS.find((definition) => definition.key === "defaultAgent")
if (!defaultAgentDefinition || defaultAgentDefinition.type !== "select") {
  throw new Error("Expected defaultAgent select definition")
}
const originalDefaultAgentOptions = defaultAgentDefinition.options?.map((option) => ({ ...option })) ?? []

function pane(id: string, options: Partial<DmuxPane> = {}): DmuxPane {
  return {
    id,
    slug: `pane-${id}`,
    prompt: `prompt-${id}`,
    paneId: `%${id}`,
    projectRoot: "/repo",
    projectName: "repo",
    worktreePath: `/repo/.dmux/worktrees/pane-${id}`,
    ...options,
  }
}

function Harness({
  settingsManager,
  getSettingsManagerForProjectRoot = vi.fn(() => settingsManager),
  setStatusMessage = vi.fn(),
  setInlineSettingsMode = vi.fn(),
  setInlineSettingsEditingKey = vi.fn(),
  setInlineSettingsEditingValueIndex = vi.fn(),
  setInlineSettingsScopeIndex = vi.fn(),
  inlineSettingsEditingKey = "defaultAgent",
  inlineSettingsEditingValueIndex = 99,
  inlineSettingsScopeIndex = 0,
  inlineSettingsProjectRoot,
  setInlineSettingsProjectRoot = vi.fn(),
}: {
  settingsManager: {
    getEffectiveScope: ReturnType<typeof vi.fn>
    getSettings: ReturnType<typeof vi.fn>
    updateSetting: ReturnType<typeof vi.fn>
  }
  getSettingsManagerForProjectRoot?: ReturnType<typeof vi.fn>
  setStatusMessage?: ReturnType<typeof vi.fn>
  setInlineSettingsMode?: ReturnType<typeof vi.fn>
  setInlineSettingsEditingKey?: ReturnType<typeof vi.fn>
  setInlineSettingsEditingValueIndex?: ReturnType<typeof vi.fn>
  setInlineSettingsScopeIndex?: ReturnType<typeof vi.fn>
  inlineSettingsEditingKey?: keyof import("../src/types.js").DmuxSettings
  inlineSettingsEditingValueIndex?: number
  inlineSettingsScopeIndex?: number
  inlineSettingsProjectRoot?: string
  setInlineSettingsProjectRoot?: ReturnType<typeof vi.fn>
}) {
  useInputHandling({
    panes: [pane("1")],
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
    isCreatingPane: false,
    setIsCreatingPane: vi.fn(),
    runningCommand: false,
    isUpdating: false,
    isLoading: false,
    ignoreInput: false,
    isDevMode: false,
    quitConfirmMode: false,
    setQuitConfirmMode: vi.fn(),
    showCommandPrompt: null,
    setShowCommandPrompt: vi.fn(),
    commandInput: "",
    setCommandInput: vi.fn(),
    showFileCopyPrompt: false,
    setShowFileCopyPrompt: vi.fn(),
    currentCommandType: null,
    setCurrentCommandType: vi.fn(),
    showInlineSettings: true,
    setShowInlineSettings: vi.fn(),
    inlineSettingsIndex: 0,
    setInlineSettingsIndex: vi.fn(),
    inlineSettingsMode: "scope",
    setInlineSettingsMode,
    inlineSettingsEditingKey,
    setInlineSettingsEditingKey,
    inlineSettingsEditingValueIndex,
    setInlineSettingsEditingValueIndex,
    inlineSettingsScopeIndex,
    setInlineSettingsScopeIndex,
    inlineSettingsProjectRoot,
    setInlineSettingsProjectRoot,
    resetInlineSettings: vi.fn(),
    projectSettings: {},
    saveSettings: vi.fn(),
    settingsManager,
    getSettingsManagerForProjectRoot,
    popupManager: {
      launchSettingsPopup: vi.fn(async () => ({ kind: "cancelled" as const })),
    } as any,
    actionSystem: {
      actionState: {},
      executeAction: vi.fn(),
      executeCallback: vi.fn(),
      clearDialog: vi.fn(),
      clearStatus: vi.fn(),
      setActionState: vi.fn(),
    },
    controlPaneId: "%0",
    trackProjectActivity: vi.fn(async (work: () => unknown) => await work()),
    presentationMode: "grid",
    popupsSupported: true,
    setStatusMessage,
    copyNonGitFiles: vi.fn(),
    runCommandInternal: vi.fn(),
    handlePaneCreationWithAgent: vi.fn(async () => []),
    handleCreateChildWorktree: vi.fn(async () => []),
    handleReopenWorktree: vi.fn(async () => null),
    setDevSourceFromPane: vi.fn(),
    savePanes: vi.fn(async () => {}),
    sidebarProjects: [{ projectRoot: "/repo", projectName: "repo" }],
    saveSidebarProjects: vi.fn(async (projects) => projects),
    loadPanes: vi.fn(async () => {}),
    cleanExit: vi.fn(),
    availableAgents: ["claude", "codex"],
    panesFile: "/repo/.dmux/dmux.config.json",
    projectRoot: "/repo",
    projectActionItems: [],
    findCardInDirection: vi.fn(() => null),
  })

  return <Text>dmux</Text>
}

describe("useInputHandling inline settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    defaultAgentDefinition.options = originalDefaultAgentOptions.map((option) => ({ ...option }))
    vi.spyOn(TmuxService, "getInstance").mockReturnValue({
      selectPane: vi.fn(async () => {}),
      joinPaneToTarget: vi.fn(async () => {}),
      breakPaneToWindow: vi.fn(async () => {}),
      splitPane: vi.fn(async () => "%2"),
    } as unknown as TmuxService)
  })

  it("falls back to the first valid select option when the edited index is out of range", async () => {
    defaultAgentDefinition.options = [
      { value: "codex", label: "Codex" },
      { value: "claude", label: "Claude" },
    ]

    const settingsManager = {
      getEffectiveScope: vi.fn(() => "global"),
      getSettings: vi.fn(() => ({ defaultAgent: "claude" })),
      updateSetting: vi.fn(),
    }
    const setStatusMessage = vi.fn()
    const setInlineSettingsMode = vi.fn()
    const setInlineSettingsEditingKey = vi.fn()
    const setInlineSettingsEditingValueIndex = vi.fn()
    const setInlineSettingsScopeIndex = vi.fn()

    const { stdin, unmount } = render(
      <Harness
        settingsManager={settingsManager}
        setStatusMessage={setStatusMessage}
        setInlineSettingsMode={setInlineSettingsMode}
        setInlineSettingsEditingKey={setInlineSettingsEditingKey}
        setInlineSettingsEditingValueIndex={setInlineSettingsEditingValueIndex}
        setInlineSettingsScopeIndex={setInlineSettingsScopeIndex}
      />
    )

    await sleep(20)
    stdin.write("\r")
    await sleep(80)

    expect(settingsManager.updateSetting).toHaveBeenCalledWith(
      "defaultAgent",
      "codex",
      "global"
    )
    expect(setStatusMessage).toHaveBeenCalledWith("Setting saved (global)")
    expect(setInlineSettingsMode).toHaveBeenCalledWith("list")
    expect(setInlineSettingsEditingKey).toHaveBeenCalledWith(undefined)
    expect(setInlineSettingsEditingValueIndex).toHaveBeenCalledWith(0)
    expect(setInlineSettingsScopeIndex).toHaveBeenCalledWith(0)

    unmount()
  })

  it("shows an error and skips persistence when a select setting has no options", async () => {
    defaultAgentDefinition.options = []

    const settingsManager = {
      getEffectiveScope: vi.fn(() => "global"),
      getSettings: vi.fn(() => ({ defaultAgent: "claude" })),
      updateSetting: vi.fn(),
    }
    const setStatusMessage = vi.fn()
    const setInlineSettingsMode = vi.fn()
    const setInlineSettingsEditingKey = vi.fn()
    const setInlineSettingsEditingValueIndex = vi.fn()
    const setInlineSettingsScopeIndex = vi.fn()

    const { stdin, unmount } = render(
      <Harness
        settingsManager={settingsManager}
        setStatusMessage={setStatusMessage}
        setInlineSettingsMode={setInlineSettingsMode}
        setInlineSettingsEditingKey={setInlineSettingsEditingKey}
        setInlineSettingsEditingValueIndex={setInlineSettingsEditingValueIndex}
        setInlineSettingsScopeIndex={setInlineSettingsScopeIndex}
      />
    )

    await sleep(20)
    stdin.write("\r")
    await sleep(80)

    expect(settingsManager.updateSetting).not.toHaveBeenCalled()
    expect(setStatusMessage).toHaveBeenCalledWith("Default Agent has no available options")
    expect(setInlineSettingsMode).toHaveBeenCalledWith("list")
    expect(setInlineSettingsEditingKey).toHaveBeenCalledWith(undefined)
    expect(setInlineSettingsEditingValueIndex).toHaveBeenCalledWith(0)
    expect(setInlineSettingsScopeIndex).toHaveBeenCalledWith(0)

    unmount()
  })

  it("saves project-scoped inline settings to the selected non-session project root", async () => {
    defaultAgentDefinition.options = [
      { value: "codex", label: "Codex" },
      { value: "claude", label: "Claude" },
    ]

    const sessionSettingsManager = {
      getEffectiveScope: vi.fn(() => "global"),
      getSettings: vi.fn(() => ({ defaultAgent: "claude" })),
      updateSetting: vi.fn(),
    }
    const repoBSettingsManager = {
      getSettings: vi.fn(() => ({ defaultAgent: "claude" })),
      updateSetting: vi.fn(),
    }
    const getSettingsManagerForProjectRoot = vi.fn((projectRoot: string) =>
      projectRoot === "/repo-b" ? repoBSettingsManager : sessionSettingsManager
    )

    const { stdin, unmount } = render(
      <Harness
        settingsManager={sessionSettingsManager}
        getSettingsManagerForProjectRoot={getSettingsManagerForProjectRoot}
        inlineSettingsScopeIndex={1}
        inlineSettingsProjectRoot="/repo-b"
      />
    )

    await sleep(20)
    stdin.write("\r")
    await sleep(80)

    expect(repoBSettingsManager.updateSetting).toHaveBeenCalledWith(
      "defaultAgent",
      "codex",
      "project"
    )
    expect(sessionSettingsManager.updateSetting).not.toHaveBeenCalled()

    unmount()
  })
})
