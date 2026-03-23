import { describe, expect, it } from "vitest"
import { execSync } from "child_process"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import path from "path"
import { PopupManager, type PopupManagerConfig } from "../src/services/PopupManager.js"
import { launchNodePopupNonBlocking } from "../src/utils/popup.js"
import { createCanonicalFocusModeFixture } from "./fixtures/focusMode.js"

function hasCmd(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const runE2E = process.env.DMUX_E2E === "1"
const canRun = runE2E && hasCmd("tmux") && hasCmd("script")

async function writePopupScript(
  dir: string,
  name: string,
  body: string
): Promise<string> {
  const scriptPath = path.join(dir, name)
  await fsp.writeFile(scriptPath, body)
  await fsp.chmod(scriptPath, 0o755)
  return scriptPath
}

async function withPopupHarness(
  callback: (context: {
    tmpDir: string
    logPath: string
    createPopupManager: () => PopupManager
    waitForLog: (pattern: string, timeoutMs?: number) => Promise<void>
    sendClientInput: (chars: string) => Promise<void>
    writeScript: (name: string, body: string) => Promise<string>
  }) => Promise<void>
) {
  const server = `dmux-popup-${Date.now()}`
  const session = "dmux-popup"
  const width = 80
  const height = 24
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "dmux-popup-"))
  const wrapperDir = path.join(tmpDir, "bin")
  const wrapperPath = path.join(wrapperDir, "tmux")
  const logPath = path.join(tmpDir, "client.log")
  const realTmuxPath = execSync("command -v tmux", {
    encoding: "utf-8",
    stdio: "pipe",
  }).trim()
  const originalPath = process.env.PATH || ""
  let clientPid: number | null = null

  await fsp.mkdir(wrapperDir, { recursive: true })
  const writeWrapper = async (targetClient?: string) => {
    const displayPopupPrefix = targetClient
      ? `if [ "$1" = "display-popup" ]; then\n  shift\n  exec "${realTmuxPath}" -L "${server}" display-popup -c "${targetClient}" "$@"\nfi\n`
      : ""

    await fsp.writeFile(
      wrapperPath,
      `#!/bin/sh\n${displayPopupPrefix}exec "${realTmuxPath}" -L "${server}" "$@"\n`
    )
    await fsp.chmod(wrapperPath, 0o755)
  }

  await writeWrapper()
  await fsp.chmod(wrapperPath, 0o755)
  process.env.PATH = `${wrapperDir}:${originalPath}`

  try {
    execSync(
      `tmux -f /dev/null new-session -d -x ${width} -y ${height} -s ${session} -n main 'sleep 100000'`,
      { stdio: "pipe" }
    )
    execSync(
      `tmux resize-window -t ${session}:0 -x ${width} -y ${height}`,
      { stdio: "pipe" }
    )

    clientPid = Number(
      execSync(
        `script -q ${shellQuote(logPath)} tmux attach-session -t ${shellQuote(session)} >/dev/null 2>&1 & echo $!`,
        {
          encoding: "utf-8",
          stdio: "pipe",
          env: { ...process.env, PATH: `${wrapperDir}:${originalPath}` },
        }
      ).trim()
    )

    let targetClient = ""
    const clientDiscoveryStartedAt = Date.now()

    while (!targetClient && Date.now() - clientDiscoveryStartedAt < 5000) {
      targetClient = execSync(`tmux list-clients -F '#{client_tty}' | head -n 1`, {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim()

      if (!targetClient) {
        await sleep(100)
      }
    }

    if (!targetClient) {
      throw new Error("Failed to discover attached tmux client for popup targeting")
    }

    await writeWrapper(targetClient)

    const waitForLog = async (pattern: string, timeoutMs: number = 5000) => {
      const startedAt = Date.now()

      while (Date.now() - startedAt < timeoutMs) {
        const log = await fsp.readFile(logPath, "utf-8").catch(() => "")
        if (log.includes(pattern)) {
          return
        }
        await sleep(50)
      }

      throw new Error(`Did not find "${pattern}" in client log within ${timeoutMs}ms`)
    }

    const sendClientInput = async (chars: string) => {
      if (!targetClient) {
        throw new Error("tmux client target is unavailable")
      }

      if (chars === "\u001b") {
        execSync(`tmux send-keys -c ${shellQuote(targetClient)} Escape`, {
          stdio: "pipe",
        })
      } else {
        execSync(
          `tmux send-keys -c ${shellQuote(targetClient)} -l ${shellQuote(chars)}`,
          {
            stdio: "pipe",
          }
        )
      }
      await sleep(200)
    }

    const createPopupManager = () => {
      const config: PopupManagerConfig = {
        sidebarWidth: 40,
        projectRoot: "/repo-a",
        popupsSupported: true,
        isDevMode: true,
        terminalWidth: width,
        terminalHeight: height,
        availableAgents: ["claude", "codex"],
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

    await callback({
      tmpDir,
      logPath,
      createPopupManager,
      waitForLog,
      sendClientInput,
      writeScript: (name, body) => writePopupScript(tmpDir, name, body),
    })
  } finally {
    if (clientPid) {
      try {
        process.kill(clientPid, "SIGTERM")
      } catch {}
    }
    process.env.PATH = originalPath
    try {
      execSync(`"${realTmuxPath}" -L "${server}" kill-server`, { stdio: "pipe" })
    } catch {}
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

describe.sequential("popup launcher tmux smoke", () => {
  it.runIf(canRun)("returns an error when a popup exits before ready without writing a result", async () => {
    await withPopupHarness(async ({ writeScript }) => {
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
    await withPopupHarness(async ({ sendClientInput, waitForLog, writeScript }) => {
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

  it.runIf(canRun)("shows the focus action sheet on an 80x24 client after selecting more", async () => {
    await withPopupHarness(async ({
      createPopupManager,
      sendClientInput,
      waitForLog,
      writeScript,
    }) => {
      const fixture = createCanonicalFocusModeFixture({ includeRunningProcess: true })
      const pane = fixture.selectedPane

      const navigatorScript = await writeScript(
        "focusNavigatorPopup.js",
        `import fs from 'fs'
const resultFile = process.argv[2]
const dataFile = process.argv[3]
const readyFile = process.env.DMUX_POPUP_READY_FILE
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
if (readyFile) fs.writeFileSync(readyFile, 'ready')
console.log('Focus Navigator Ready')
console.log(data.projectName)
if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  if (chunk.includes(0x6d)) {
    fs.writeFileSync(resultFile, JSON.stringify({
      success: true,
      data: {
        kind: 'pane',
        action: 'more',
        paneId: data.selectedPaneId
      }
    }))
    process.exit(0)
  }
  if (chunk.includes(0x1b)) {
    fs.writeFileSync(resultFile, JSON.stringify({ success: false, cancelled: true }))
    process.exit(0)
  }
})
setInterval(() => {}, 1000)
`
      )

      const actionSheetScript = await writeScript(
        "focusActionSheetPopup.js",
        `import fs from 'fs'
const resultFile = process.argv[2]
const paneName = process.argv[3]
const readyFile = process.env.DMUX_POPUP_READY_FILE
if (readyFile) fs.writeFileSync(readyFile, 'ready')
console.log('Actions: ' + paneName)
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
        if (scriptName === "focusNavigatorPopup.js") {
          return navigatorScript
        }
        if (scriptName === "focusActionSheetPopup.js") {
          return actionSheetScript
        }
        throw new Error(`Unexpected popup script: ${scriptName}`)
      }

      const navigatorPromise = manager.launchFocusNavigatorPopup({
        panes: fixture.panes,
        sidebarProjects: fixture.sidebarProjects,
        projectRoot: fixture.sessionProjectRoot,
        projectName: fixture.projectName,
        selectedPaneId: pane.id,
        selectedProjectRoot: pane.projectRoot,
      })

      await waitForLog("Focus Navigator Ready")
      await sendClientInput("m")

      await expect(navigatorPromise).resolves.toEqual({
        kind: "pane",
        action: "more",
        paneId: pane.id,
      })

      const actionSheetPromise = manager.launchFocusActionSheetPopup(
        pane,
        fixture.panes
      )

      await waitForLog(`Actions: ${pane.slug}`)
      await sendClientInput("\u001b")
      await expect(actionSheetPromise).resolves.toBeNull()
    })
  }, 120000)
})
