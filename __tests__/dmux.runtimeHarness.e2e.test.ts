import { describe, expect, it } from "vitest"
import * as fs from "fs"
import {
  canRunDmuxRuntimeE2E,
  withDmuxRuntimeHarness,
} from "./helpers/dmuxRuntimeHarness.js"

describe.sequential("dmux runtime harness", () => {
  it.runIf(canRunDmuxRuntimeE2E)("starts dmux with a temp home and discovers an attached client", async () => {
    await withDmuxRuntimeHarness(async (harness) => {
      const repoA = await harness.createProject("repo-a", {
        presentationMode: "focus",
      })

      await harness.startDmux(repoA)

      expect(harness.getClientTarget()).toBeTruthy()
      expect(await harness.getControlPaneId()).toMatch(/^%/)

      const config = await harness.readConfig(repoA)
      expect(fs.realpathSync(config!.projectRoot)).toBe(fs.realpathSync(repoA.root))
      expect(config?.controlPaneId).toMatch(/^%/)
    })
  }, 120000)

  it.runIf(canRunDmuxRuntimeE2E)("opens the pane-anchored menu from a real work pane on 80x24", async () => {
    await withDmuxRuntimeHarness(async (harness) => {
      const repoA = await harness.createProject("repo-a", {
        presentationMode: "focus",
      })

      await harness.startDmux(repoA)
      await harness.sendControlInput("t")
      await harness.waitForPaneCount(repoA, 1)

      await harness.openPaneMenuFromActivePane()

      await harness.sendClientInput("Escape")
    })
  }, 120000)

  it.runIf(!canRunDmuxRuntimeE2E)("skipped: tmux/script/runner not available or DMUX_E2E is not enabled", () => {})
})
