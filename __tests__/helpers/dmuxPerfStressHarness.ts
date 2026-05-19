import { execFileSync } from "child_process"
import * as fsp from "fs/promises"
import * as path from "path"
import { writeDmuxPerfClientMarker } from "../../src/utils/perf.js"
import { writeClientInputWindowEvent } from "../../src/utils/perfProbe.js"
import {
  formatPerfReport,
  loadPerfEventsFromDir,
  summarizePerfEvents,
  type ClientInputWindowSummary,
  type PerfInstanceSummary,
} from "../../src/utils/perfReport.js"
import type { DmuxConfig, DmuxPane, PermissionMode } from "../../src/types.js"
import { sleep, type DmuxRuntimeHarness, type RuntimeProject } from "./dmuxRuntimeHarness.js"

const CORE_MISSING_METRICS = [
  "handled visible key-to-render samples < 30",
  "tmux command timings",
  "worker capture timings",
  "client input window",
  "client-observed markers",
  "worker count metadata",
]

export interface PerfIdentity {
  perfDir: string
  runId: string
  instanceLabel: string
  transport: string
}

export interface SeedTrackedCodexPanesOptions {
  count: number
  idPrefix: string
  slugPrefix: string
  permissionMode: PermissionMode
  promptForIndex: (index: number) => string
  waitTimeoutMs?: number
  initialStatus?: DmuxPane["agentStatus"]
  replaceExisting?: boolean
}

export interface RecordNavigationWindowOptions extends PerfIdentity {
  harness: DmuxRuntimeHarness
  label: string
  inputCount: number
  keyForIndex?: (index: number) => string
  settleMs?: number
}

export async function seedTrackedCodexPanes(
  harness: DmuxRuntimeHarness,
  project: RuntimeProject,
  options: SeedTrackedCodexPanesOptions
): Promise<DmuxPane[]> {
  const controlPaneId = await harness.getControlPaneId()
  if (!controlPaneId) {
    throw new Error("dmux control pane is unavailable")
  }

  const panes: DmuxPane[] = []
  for (let index = 0; index < options.count; index += 1) {
    const ordinal = index + 1
    const slug = `${options.slugPrefix}-${ordinal}`
    const prompt = options.promptForIndex(index)
    const paneId = await harness.splitPaneDirect({
      targetPaneId: controlPaneId,
      cwd: project.root,
      preserveZoom: false,
    })

    await harness.sendPaneCommand(
      paneId,
      `cd ${shellQuote(project.root)} && codex --enable codex_hooks ${shellQuote(prompt)}`
    )

    panes.push({
      id: `${options.idPrefix}-${ordinal}`,
      slug,
      branchName: slug,
      prompt,
      paneId,
      projectRoot: project.root,
      projectName: project.name,
      worktreePath: project.root,
      agent: "codex",
      hidden: false,
      permissionMode: options.permissionMode,
      agentStatus: options.initialStatus ?? "working",
    })
  }

  const config = await harness.readConfig(project)
  if (!config) {
    throw new Error("dmux config is unavailable")
  }

  const nextConfig: DmuxConfig = {
    ...config,
    panes: options.replaceExisting === false ? [...config.panes, ...panes] : panes,
    lastUpdated: new Date().toISOString(),
  }
  await fsp.writeFile(project.configPath, JSON.stringify(nextConfig, null, 2))
  await waitForControlPaneText(
    harness,
    panes[panes.length - 1]?.slug || options.slugPrefix,
    options.waitTimeoutMs ?? 15000
  )

  return panes
}

export async function recordNavigationWindow(options: RecordNavigationWindowOptions): Promise<void> {
  const controlPaneId = await options.harness.getControlPaneId()
  if (!controlPaneId) {
    throw new Error("dmux control pane is unavailable")
  }

  await options.harness.selectPaneDirect(controlPaneId, { preserveZoom: true })
  writeClientMarker(options, `${options.label}-start`)
  const startedAt = new Date()
  for (let index = 0; index < options.inputCount; index += 1) {
    await options.harness.sendClientInput(options.keyForIndex?.(index) || defaultNavigationKey(index))
  }
  const stoppedAt = new Date()
  writeClientMarker(options, `${options.label}-stop`)
  await sleep(options.settleMs ?? 1000)

  writeClientInputWindowEvent({
    runId: options.runId,
    instanceLabel: options.instanceLabel,
    transport: options.transport,
    label: options.label,
    startedAt,
    stoppedAt,
    perfDir: options.perfDir,
    filePath: path.join(options.perfDir, `dmux-client-window-${options.label}.jsonl`),
  })
}

export async function loadPerfInstance(
  identity: PerfIdentity
): Promise<{ instance: PerfInstanceSummary; report: string }> {
  const parsed = await loadPerfEventsFromDir(identity.perfDir)
  const summary = summarizePerfEvents(parsed.events, parsed.errors)
  const report = formatPerfReport(summary)

  if (summary.parseErrors.length > 0) {
    throw new Error(`Perf parse errors:\n${summary.parseErrors.join("\n")}\n\n${report}`)
  }

  const instance = summary.instances.find(
    (candidate) =>
      candidate.runId === identity.runId &&
      candidate.instanceLabel === identity.instanceLabel &&
      candidate.transport === identity.transport
  )

  if (!instance) {
    throw new Error(
      `No perf instance found for ${identity.runId}/${identity.instanceLabel}/${identity.transport}\n\n${report}`
    )
  }

  return { instance, report }
}

export function requireStressWindowSample(
  instance: PerfInstanceSummary,
  label: string,
  minimums: {
    handledVisibleInputCount: number
    matchedKeyToRenderCount: number
    renderCount: number
  },
  report: string
): ClientInputWindowSummary {
  const window = instance.clientInputWindows.find((candidate) => candidate.label === label)
  if (!window) {
    throw new Error(`Missing client input window ${label}\n\n${report}`)
  }

  requireAtLeast(
    window.handledVisibleInputCount,
    minimums.handledVisibleInputCount,
    `${label} handled visible inputs`,
    report
  )
  requireAtLeast(
    window.matchedKeyToRenderCount,
    minimums.matchedKeyToRenderCount,
    `${label} matched key-to-render samples`,
    report
  )
  requireAtLeast(window.renderCount, minimums.renderCount, `${label} renders`, report)
  return window
}

export function requireNoCoreMissingMetrics(
  instance: PerfInstanceSummary,
  report: string,
  sampleName: string
): void {
  for (const missing of CORE_MISSING_METRICS) {
    if (instance.missing.includes(missing)) {
      throw new Error(`${sampleName} sample is missing ${missing}\n\n${report}`)
    }
  }
}

export function requireAtLeast(value: number, minimum: number, label: string, report: string): void {
  if (value < minimum) {
    throw new Error(`Expected ${label} >= ${minimum}, got ${value}\n\n${report}`)
  }
}

export async function cleanupPerfScratchDir(options: {
  succeeded: boolean
  scratchDir: string
  perfDir: string
}): Promise<void> {
  if (options.succeeded && process.env.DMUX_E2E_KEEP_PERF_ARTIFACTS === "1") {
    console.info(`Perf artifacts kept: ${options.perfDir}`)
  } else if (options.succeeded) {
    await fsp.rm(options.scratchDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function readBoundedIntegerEnv(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const rawValue = process.env[name]
  if (!rawValue) {
    return defaultValue
  }

  const parsed = Number(rawValue)
  if (!Number.isInteger(parsed)) {
    return defaultValue
  }

  return Math.max(minimum, Math.min(maximum, parsed))
}

export function commandOutput(command: string): string {
  return execFileSync("sh", ["-lc", command], {
    encoding: "utf-8",
    stdio: "pipe",
  }).trim()
}

function writeClientMarker(identity: PerfIdentity, marker: string): void {
  const previousPerfDir = process.env.DMUX_PERF_DIR
  try {
    process.env.DMUX_PERF_DIR = identity.perfDir
    writeDmuxPerfClientMarker({
      runId: identity.runId,
      marker,
      instanceLabel: identity.instanceLabel,
      transport: identity.transport,
    })
  } finally {
    if (previousPerfDir === undefined) {
      delete process.env.DMUX_PERF_DIR
    } else {
      process.env.DMUX_PERF_DIR = previousPerfDir
    }
  }
}

async function waitForControlPaneText(
  harness: DmuxRuntimeHarness,
  expectedText: string,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now()
  let lastCapture = ""

  while (Date.now() - startedAt < timeoutMs) {
    lastCapture = await harness.readControlPaneCapture()
    if (lastCapture.includes(expectedText)) {
      return
    }
    await sleep(250)
  }

  throw new Error(`Timed out waiting for control pane to include "${expectedText}"\n${lastCapture}`)
}

function defaultNavigationKey(index: number): string {
  return index % 2 === 0 ? "Down" : "Up"
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}
