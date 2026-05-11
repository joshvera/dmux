import { describe, expect, it } from "vitest"
import { execSync } from "child_process"
import fsp from "fs/promises"
import os from "os"
import path from "path"
import { recalculateAndApplyLayout } from "../src/utils/layoutManager.js"

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

const runE2E = process.env.DMUX_E2E === "1"
const canRun = runE2E && hasCmd("tmux")

async function withTmuxLayoutFixture(
  callback: (context: {
    controlPaneId: string
    contentPaneId: string
    readPaneRows: () => Array<{
      paneId: string
      paneWidth: number
      windowWidth: number
      title: string
    }>
  }) => Promise<void>
) {
  const server = `dmux-layout-${Date.now()}`
  const session = "dmux-layout"
  const windowWidth = 240
  const windowHeight = 60
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "dmux-layout-"))
  const wrapperDir = path.join(tmpDir, "bin")
  const wrapperPath = path.join(wrapperDir, "tmux")
  const realTmuxPath = execSync("command -v tmux", {
    encoding: "utf-8",
    stdio: "pipe",
  }).trim()
  const originalPath = process.env.PATH || ""

  await fsp.mkdir(wrapperDir, { recursive: true })
  await fsp.writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${realTmuxPath}" -L "${server}" "$@"\n`
  )
  await fsp.chmod(wrapperPath, 0o755)
  process.env.PATH = `${wrapperDir}:${originalPath}`

  try {
    execSync(
      `tmux -f /dev/null new-session -d -x ${windowWidth} -y ${windowHeight} -s ${session} -n main sh`,
      { stdio: "pipe" }
    )
    execSync(
      `tmux resize-window -t ${session}:0 -x ${windowWidth} -y ${windowHeight}`,
      { stdio: "pipe" }
    )

    const controlPaneId = execSync(
      `tmux list-panes -t ${session}:0 -F '#{pane_id}' | head -n 1`,
      {
        encoding: "utf-8",
        stdio: "pipe",
      }
    ).trim()
    const contentPaneId = execSync(
      `tmux split-window -h -t '${controlPaneId}' -P -F '#{pane_id}'`,
      {
        encoding: "utf-8",
        stdio: "pipe",
      }
    ).trim()

    const readPaneRows = () =>
      execSync(
        `tmux list-panes -t ${session}:0 -F '#{pane_id}\t#{pane_width}\t#{window_width}\t#{pane_title}'`,
        {
          encoding: "utf-8",
          stdio: "pipe",
        }
      )
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [paneId, paneWidthValue, windowWidthValue, title] = line.split("\t")
          return {
            paneId,
            paneWidth: Number(paneWidthValue),
            windowWidth: Number(windowWidthValue),
            title,
          }
        })

    await callback({ controlPaneId, contentPaneId, readPaneRows })
  } finally {
    process.env.PATH = originalPath
    try {
      execSync(`"${realTmuxPath}" -L "${server}" kill-server`, { stdio: "pipe" })
    } catch {}
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

describe.sequential("layout tmux smoke", () => {
  it.runIf(canRun)("uses the full content width when only one content pane is visible", async () => {
    await withTmuxLayoutFixture(async ({ controlPaneId, contentPaneId, readPaneRows }) => {
      await recalculateAndApplyLayout(controlPaneId, [contentPaneId], 240, 60)
      await sleep(100)

      const paneRows = readPaneRows()
      const contentPane = paneRows.find((pane) => pane.paneId === contentPaneId)

      expect(paneRows).toHaveLength(2)
      expect(paneRows.some((pane) => pane.title === "dmux-spacer")).toBe(false)
      expect(contentPane).toBeTruthy()
      expect(contentPane?.windowWidth).toBe(240)
      expect(contentPane?.paneWidth).toBe(199)
    })
  }, 120000)

  it.runIf(!canRun)("skipped: tmux not available or DMUX_E2E is not enabled", () => {})
})
