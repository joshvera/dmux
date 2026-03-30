import { describe, expect, it } from "vitest"
import { launchNodePopupNonBlocking } from "../src/utils/popup.js"
import { createCanonicalFocusModeFixture } from "./fixtures/focusMode.js"
import {
  canRunTmuxPopupE2E,
  withAttachedTmuxClient,
} from "./helpers/dmuxRuntimeHarness.js"

const canRun = canRunTmuxPopupE2E

describe.sequential("popup launcher tmux smoke", () => {
  it.runIf(canRun)("returns an error when a popup exits before ready without writing a result", async () => {
    await withAttachedTmuxClient(async ({ writeScript }) => {
      const scriptPath = await writeScript(
        "early-exit.mjs",
        `process.exit(1)\n`
      )

      const popupHandle = launchNodePopupNonBlocking(scriptPath, [], {
        width: 30,
        height: 8,
        title: "Early Exit",
      })

      await popupHandle.readyPromise
      const result = await popupHandle.resultPromise

      expect(result.success).toBe(false)
      expect(result.cancelled).not.toBe(true)
      expect(result.error).toMatch(/Popup exited before ready/)
      expect(result.error).toMatch(/code 1/)
    })
  }, 120000)

  it.runIf(canRun)("keeps normal escape cancellation after a popup becomes ready", async () => {
    await withAttachedTmuxClient(async ({ sendClientInput, waitForLog, writeScript }) => {
      const scriptPath = await writeScript(
        "cancel-on-escape.mjs",
        `import fs from 'fs'
const resultFile = process.argv[2]
const readyFile = process.env.DMUX_POPUP_READY_FILE
if (readyFile) fs.writeFileSync(readyFile, 'ready')
console.log('Cancel Popup Ready')
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  if (chunk.includes(0x1b)) {
    fs.writeFileSync(resultFile, JSON.stringify({ success: false, cancelled: true }))
    process.exit(0)
  }
})
setInterval(() => {}, 1000)
`
      )

      const popupHandle = launchNodePopupNonBlocking(scriptPath, [], {
        width: 40,
        height: 10,
        title: "Cancel Popup",
      })

      await popupHandle.readyPromise
      await waitForLog("Cancel Popup Ready")
      await sendClientInput("\u001b")

      const result = await popupHandle.resultPromise
      expect(result).toEqual({
        success: false,
        cancelled: true,
      })
    })
  }, 120000)

  it.runIf(canRun)("shows the pane-anchored menu on an 80x24 client", async () => {
    await withAttachedTmuxClient(async ({
      createPopupManager,
      sendClientInput,
      waitForLog,
      writeScript,
    }) => {
      const fixture = createCanonicalFocusModeFixture({ includeRunningProcess: true })
      const pane = fixture.selectedPane

      const kebabScript = await writeScript(
        "kebabMenuPopup.js",
        `import fs from 'fs'
const resultFile = process.argv[2]
const paneName = process.argv[3]
const readyFile = process.env.DMUX_POPUP_READY_FILE
if (readyFile) fs.writeFileSync(readyFile, 'ready')
console.log('Menu: ' + paneName)
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  if (chunk.includes(0x1b)) {
    fs.writeFileSync(resultFile, JSON.stringify({ success: false, cancelled: true }))
    process.exit(0)
  }
})
setInterval(() => {}, 1000)
`
      )

      const manager = createPopupManager() as any
      manager.getPopupScriptPath = (scriptName: string) => {
        if (scriptName === "kebabMenuPopup.js") {
          return kebabScript
        }
        throw new Error(`Unexpected popup script: ${scriptName}`)
      }

      const menuPromise = manager.launchKebabMenuPopup(
        pane,
        fixture.panes,
        { anchorToPane: true }
      )

      await waitForLog(`Menu: ${pane.slug}`)
      await sendClientInput("\u001b")
      await expect(menuPromise).resolves.toBeNull()
    })
  }, 120000)
})
