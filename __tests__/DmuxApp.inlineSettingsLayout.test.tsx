import React from "react"
import { Text } from "ink"
import { render } from "ink-testing-library"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  dialogStateRef,
  layoutManagementMock,
  inputHandlingMock,
} = vi.hoisted(() => ({
  dialogStateRef: {
    current: null as any,
  },
  layoutManagementMock: vi.fn(),
  inputHandlingMock: vi.fn(),
}))

function createDialogState(overrides: Record<string, unknown> = {}) {
  return {
    showCommandPrompt: null,
    setShowCommandPrompt: vi.fn(),
    commandInput: "",
    setCommandInput: vi.fn(),
    showFileCopyPrompt: false,
    setShowFileCopyPrompt: vi.fn(),
    currentCommandType: null,
    setCurrentCommandType: vi.fn(),
    runningCommand: false,
    setRunningCommand: vi.fn(),
    quitConfirmMode: false,
    setQuitConfirmMode: vi.fn(),
    showInlineSettings: false,
    setShowInlineSettings: vi.fn(),
    inlineSettingsIndex: 0,
    setInlineSettingsIndex: vi.fn(),
    inlineSettingsMode: "list" as const,
    setInlineSettingsMode: vi.fn(),
    inlineSettingsEditingKey: undefined,
    setInlineSettingsEditingKey: vi.fn(),
    inlineSettingsEditingValueIndex: 0,
    setInlineSettingsEditingValueIndex: vi.fn(),
    inlineSettingsScopeIndex: 0,
    setInlineSettingsScopeIndex: vi.fn(),
    resetInlineSettings: vi.fn(),
    ...overrides,
  }
}

vi.mock("../src/hooks/usePanes.js", () => ({
  default: () => ({
    panes: [],
    setPanes: vi.fn(),
    sidebarProjects: [],
    isLoading: false,
    loadPanes: vi.fn(async () => {}),
    savePanes: vi.fn(async () => {}),
    saveSidebarProjects: vi.fn(async (projects: any[]) => projects),
  }),
}))

vi.mock("../src/hooks/useProjectSettings.js", () => ({
  default: () => ({
    projectSettings: {},
    saveSettings: vi.fn(async () => {}),
  }),
}))

vi.mock("../src/hooks/useTerminalWidth.js", () => ({
  default: () => 120,
}))

vi.mock("../src/hooks/useNavigation.js", () => ({
  default: () => ({
    getCardGridPosition: () => ({ row: 0, col: 0 }),
    findCardInDirection: () => null,
  }),
}))

vi.mock("../src/hooks/useAutoUpdater.js", () => ({
  default: () => ({
    updateInfo: null,
    isUpdating: false,
    updateAvailable: false,
  }),
}))

vi.mock("../src/hooks/useAgentStatus.js", () => ({
  default: () => ({}),
}))

vi.mock("../src/hooks/usePaneRunner.js", () => ({
  default: () => ({
    copyNonGitFiles: vi.fn(async () => {}),
    runCommandInternal: vi.fn(async () => {}),
  }),
}))

vi.mock("../src/hooks/usePaneCreation.js", () => ({
  default: () => ({
    createNewPane: vi.fn(async () => []),
    createPanesForAgents: vi.fn(async () => []),
  }),
}))

vi.mock("../src/hooks/useActionSystem.js", () => ({
  default: () => ({
    actionState: {},
    executeAction: vi.fn(async () => {}),
    executeCallback: vi.fn(async (work: () => unknown) => await work()),
    clearDialog: vi.fn(),
    clearStatus: vi.fn(),
    setActionState: vi.fn(),
  }),
}))

vi.mock("../src/hooks/useStatusMessages.js", () => ({
  useStatusMessages: () => ({
    statusMessage: "",
    setStatusMessage: vi.fn(),
  }),
}))

vi.mock("../src/hooks/useLayoutManagement.js", () => ({
  useLayoutManagement: layoutManagementMock,
}))

vi.mock("../src/hooks/useInputHandling.js", () => ({
  useInputHandling: inputHandlingMock,
}))

vi.mock("../src/hooks/useDialogState.js", () => ({
  useDialogState: () => dialogStateRef.current,
}))

vi.mock("../src/hooks/useDebugInfo.js", () => ({
  useDebugInfo: () => ({
    debugMessage: "",
    setDebugMessage: vi.fn(),
    currentBranch: "",
  }),
}))

vi.mock("../src/hooks/useProjectActivity.js", () => ({
  useProjectActivity: () => ({
    trackProjectActivity: async (work: () => unknown) => await work(),
    isProjectBusy: () => false,
  }),
}))

vi.mock("../src/hooks/useServices.js", () => ({
  useServices: () => ({
    popupManager: {
      launchConfirmPopup: vi.fn(),
      launchChoicePopup: vi.fn(),
      launchInputPopup: vi.fn(),
      launchProgressPopup: vi.fn(),
    },
  }),
}))

vi.mock("../src/services/DmuxFocusService.js", () => ({
  DmuxFocusService: class {
    async start() {}
    stop() {}
  },
}))

vi.mock("../src/services/DmuxAttentionService.js", () => ({
  DmuxAttentionService: class {
    start() {}
    stop() {}
    on() {}
    off() {}
  },
}))

vi.mock("../src/services/PaneLifecycleManager.js", () => ({
  PaneLifecycleManager: {
    getInstance: () => ({
      cleanupStaleOperations: vi.fn(),
      isClosing: () => false,
      isLocked: () => false,
    }),
  },
}))

vi.mock("../src/shared/StateManager.js", () => ({
  StateManager: {
    getInstance: () => ({
      getState: () => ({
        unreadErrorCount: 0,
        unreadWarningCount: 0,
        currentToast: null,
        toastQueueLength: 0,
        toastQueuePosition: null,
      }),
      subscribe: () => () => {},
      setDebugMessage: vi.fn(),
      showToast: vi.fn(),
    }),
  },
}))

vi.mock("../src/services/PaneEventService.js", () => ({
  PaneEventService: {
    getInstance: () => ({
      initialize: vi.fn(),
      canUseHooks: vi.fn(async () => true),
    }),
  },
}))

vi.mock("../src/services/StatusDetector.js", () => ({
  getStatusDetector: () => ({
    on: vi.fn(),
    off: vi.fn(),
  }),
}))

vi.mock("../src/utils/settingsManager.js", () => ({
  SettingsManager: class {
    getSettings() {
      return { showFooterTips: false }
    }
    getGlobalSettings() {
      return {}
    }
    getProjectSettings() {
      return {}
    }
    updateSetting() {}
  },
  SETTING_DEFINITIONS: [],
}))

vi.mock("../src/utils/popup.js", () => ({
  supportsPopups: () => true,
}))

vi.mock("../src/components/panes/PanesGrid.js", () => ({
  default: () => <Text>Panes</Text>,
}))

vi.mock("../src/components/dialogs/CommandPromptDialog.js", () => ({
  default: () => null,
}))

vi.mock("../src/components/ui/FileCopyPrompt.js", () => ({
  default: () => null,
}))

vi.mock("../src/components/ui/FooterHelp.js", () => ({
  default: () => null,
}))

vi.mock("../src/components/dialogs/TmuxHooksPromptDialog.js", () => ({
  default: () => null,
}))

vi.mock("../src/components/dialogs/SettingsDialog.js", () => ({
  default: () => <Text>Inline Settings</Text>,
}))

import DmuxApp from "../src/DmuxApp.js"

describe("DmuxApp inline settings layout suspension", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialogStateRef.current = createDialogState()
  })

  it("marks inline settings as an active dialog for layout suspension", () => {
    dialogStateRef.current = createDialogState({
      showInlineSettings: true,
    })

    const { unmount } = render(
      <DmuxApp
        panesFile="/repo/.dmux/dmux.config.json"
        projectName="repo"
        sessionName="dmux-test"
        settingsFile="/repo/.dmux/settings.json"
        projectRoot="/repo"
        controlPaneId="%0"
      />
    )

    expect(layoutManagementMock).toHaveBeenCalled()
    expect(layoutManagementMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        controlPaneId: "%0",
        hasActiveDialog: true,
      })
    )

    unmount()
  })
})
