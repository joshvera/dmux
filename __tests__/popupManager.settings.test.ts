import { describe, expect, it, vi } from "vitest"
import { PopupManager, type PopupManagerConfig } from "../src/services/PopupManager.js"

function createPopupManager(popupsSupported: boolean = true): PopupManager {
  const config: PopupManagerConfig = {
    sidebarWidth: 40,
    projectRoot: "/tmp/project",
    popupsSupported,
    isDevMode: false,
    terminalWidth: 120,
    terminalHeight: 40,
    availableAgents: ["claude"],
    settingsManager: {
      getSettings: () => ({}),
      getGlobalSettings: () => ({}),
      getProjectSettings: () => ({}),
    },
    projectSettings: {},
    trackProjectActivity: async (work) => await work(),
  }

  return new PopupManager(config, () => {}, () => {})
}

describe("PopupManager launchSettingsPopup", () => {
  it("reports unsupported popup environments explicitly", async () => {
    const manager = createPopupManager(false)

    await expect(
      manager.launchSettingsPopup(async () => {})
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "unsupported",
    })
  })

  it("preserves popup cancellation instead of collapsing it into fallback-unavailable", async () => {
    const manager = createPopupManager() as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: false,
      cancelled: true,
    })

    await expect(
      manager.launchSettingsPopup(async () => {})
    ).resolves.toEqual({
      kind: "cancelled",
    })
  })

  it("normalizes successful updates into the completed updates array shape", async () => {
    const manager = createPopupManager() as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: {
        key: "presentationMode",
        value: "focus",
        scope: "global",
      },
    })

    await expect(
      manager.launchSettingsPopup(async () => {})
    ).resolves.toEqual({
      kind: "completed",
      updates: [{
        key: "presentationMode",
        value: "focus",
        scope: "global",
      }],
    })
  })
})
