import { execFileSync, spawn, type ChildProcess } from "child_process"
import { createHash } from "crypto"
import * as fs from "fs"
import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { PopupManager, type PopupManagerConfig } from "../../src/services/PopupManager.js"
import type { DmuxConfig, DmuxPane, PresentationMode } from "../../src/types.js"

export interface DmuxRunner {
  cmd: string
  label: string
}

export interface RuntimeProject {
  name: string
  root: string
  configPath: string
  settingsPath: string
}

export interface RuntimeArtifactSnapshot {
  artifactDir: string
  sessionsPath: string
  windowsPath: string
  panesPath: string
  clientLogPath: string
  controlPaneCapturePath?: string
  activePaneCapturePath?: string
  configPaths: string[]
}

export interface TmuxPaneSnapshot {
  sessionName: string
  windowIndex: number
  paneIndex: number
  paneId: string
  active: boolean
  zoomed: boolean
  title: string
}

export interface RuntimeTmuxClient {
  tty: string
  keyTable: string
}

export interface AttachedTmuxClientContext {
  tmpDir: string
  artifactDir: string
  logPath: string
  width: number
  height: number
  writeScript: (name: string, body: string) => Promise<string>
  createPopupManager: () => any
  waitForLog: (pattern: string, timeoutMs?: number, afterOffset?: number) => Promise<void>
  readLog: () => Promise<string>
  markLog: () => Promise<number>
  sendClientInput: (input: string) => Promise<void>
}

export interface RuntimeAttachedClient {
  tmpDir: string
  artifactDir: string
  logPath: string
  targetClient: string
  readLog: () => Promise<string>
  markLog: () => Promise<number>
  waitForLog: (pattern: string, timeoutMs?: number, afterOffset?: number) => Promise<void>
  sendInput: (input: string) => Promise<void>
}

const DEFAULT_CLIENT_WIDTH = 80
const DEFAULT_CLIENT_HEIGHT = 24
const CONTROL_PANE_OPTION = "@dmux_control_pane"
const DEFAULT_COMMIT_ENV = {
  GIT_AUTHOR_NAME: "dmux e2e",
  GIT_AUTHOR_EMAIL: "dmux-e2e@example.com",
  GIT_COMMITTER_NAME: "dmux e2e",
  GIT_COMMITTER_EMAIL: "dmux-e2e@example.com",
}

const TMUX_SPECIAL_KEYS = new Set([
  "Enter",
  "Escape",
  "Up",
  "Down",
  "Left",
  "Right",
  "BSpace",
  "Space",
  "C-c",
])

function encodeClientInput(input: string): string {
  switch (input) {
    case "Enter":
      return "\r"
    case "Escape":
      return "\u001b"
    case "Up":
      return "\u001b[A"
    case "Down":
      return "\u001b[B"
    case "Right":
      return "\u001b[C"
    case "Left":
      return "\u001b[D"
    case "BSpace":
      return "\u007f"
    case "Space":
      return " "
    case "C-c":
      return "\u0003"
    default:
      return input
  }
}

export const runDmuxE2E = process.env.DMUX_E2E === "1"

export function hasCommand(command: string): boolean {
  try {
    execFileSync("sh", ["-lc", `command -v ${command}`], {
      stdio: "pipe",
    })
    return true
  } catch {
    return false
  }
}

export function detectDmuxRunner(cwd: string = process.cwd()): DmuxRunner | null {
  const distPath = path.join(cwd, "dist", "index.js")
  const preferredRunner = process.env.DMUX_E2E_RUNNER?.trim()
  const pnpmDevCommand = `cd ${shellQuote(cwd)} && pnpm dev`
  const pnpmBuildDistCommand =
    `(cd ${shellQuote(cwd)} && pnpm run generate:hooks-docs && pnpm exec tsc) && node "${distPath}"`

  if (preferredRunner === "pnpm-dev" && hasCommand("pnpm")) {
    return { cmd: pnpmDevCommand, label: "pnpm-dev" }
  }

  if (preferredRunner === "pnpm-build-dist" && hasCommand("pnpm")) {
    return { cmd: pnpmBuildDistCommand, label: "pnpm-build-dist" }
  }

  if (preferredRunner === "tsx-src" && hasCommand("tsx")) {
    return {
      cmd: `tsx "${path.join(cwd, "src", "index.ts")}"`,
      label: "tsx-src",
    }
  }

  if (preferredRunner === "node-dist") {
    return fs.existsSync(distPath)
      ? { cmd: `node "${distPath}"`, label: "node-dist" }
      : null
  }

  if (fs.existsSync(distPath)) {
    return { cmd: `node "${distPath}"`, label: "node-dist" }
  }

  if (hasCommand("pnpm")) {
    return { cmd: pnpmBuildDistCommand, label: "pnpm-build-dist" }
  }

  if (hasCommand("tsx")) {
    return {
      cmd: `tsx "${path.join(cwd, "src", "index.ts")}"`,
      label: "tsx-src",
    }
  }

  return null
}

export const canRunTmuxPopupE2E = runDmuxE2E && hasCommand("tmux") && hasCommand("python3")
export const canRunDmuxRuntimeE2E = canRunTmuxPopupE2E && !!detectDmuxRunner()

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizePathForComparison(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

async function writeExecutableScript(dir: string, name: string, body: string): Promise<string> {
  const scriptPath = path.join(dir, name)
  await fsp.writeFile(scriptPath, body)
  await fsp.chmod(scriptPath, 0o755)
  return scriptPath
}

async function poll<T>(
  fn: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  description: string,
  intervalMs: number = 100
): Promise<T> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn()
    if (predicate(value)) {
      return value
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for ${description}`)
}

class AttachedTmuxClientHarness {
  readonly server: string
  readonly session: string
  readonly width: number
  readonly height: number
  readonly tmpDir: string
  readonly artifactDir: string
  readonly logPath: string
  readonly wrapperDir: string
  readonly wrapperPath: string
  readonly realTmuxPath: string
  readonly bridgePath: string
  readonly env: NodeJS.ProcessEnv

  private clientProcess: ChildProcess | null = null
  private targetClient = ""

  constructor(
    sessionName: string,
    width: number,
    height: number,
    rootDir: string,
    baseEnv: NodeJS.ProcessEnv,
    options: {
      server?: string
    } = {}
  ) {
    this.server = options.server ?? `dmux-e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    this.session = sessionName
    this.width = width
    this.height = height
    this.tmpDir = rootDir
    this.artifactDir = path.join(rootDir, "artifacts")
    this.logPath = path.join(this.artifactDir, "client.log")
    this.wrapperDir = path.join(rootDir, "bin")
    this.wrapperPath = path.join(this.wrapperDir, "tmux")
    this.bridgePath = path.join(rootDir, "attached-client-bridge.py")
    this.realTmuxPath = execFileSync("sh", ["-lc", "command -v tmux"], {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim()
    this.env = baseEnv
  }

  async setup(
    command: string = "sleep 100000",
    options: {
      createSession?: boolean
      knownClients?: string[]
    } = {}
  ): Promise<void> {
    await fsp.mkdir(this.artifactDir, { recursive: true })
    await fsp.mkdir(this.wrapperDir, { recursive: true })
    await this.writeWrapper()
    await this.writeBridge()

    if (options.createSession !== false) {
      this.execTmux([
        "-f",
        "/dev/null",
        "new-session",
        "-d",
        "-x",
        String(this.width),
        "-y",
        String(this.height),
        "-s",
        this.session,
        "-n",
        "main",
        command,
      ])
      this.execTmux([
        "resize-window",
        "-t",
        `${this.session}:0`,
        "-x",
        String(this.width),
        "-y",
        String(this.height),
      ])
    }

    this.clientProcess = spawn(
      "python3",
      [this.bridgePath, this.logPath, this.realTmuxPath, this.server, this.session],
      {
        env: this.env,
        stdio: ["pipe", "ignore", "ignore"],
      }
    )

    const knownClients = new Set(options.knownClients ?? [])
    const clientTargets = await poll(
      () =>
        this.execTmux(["list-clients", "-F", "#{client_tty}"])
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
      (value) => value.some((clientTty) => !knownClients.has(clientTty)),
      5000,
      "an attached tmux client"
    )
    const targetClient = clientTargets.find(
      (clientTty) => !knownClients.has(clientTty)
    )
    if (!targetClient) {
      throw new Error("Failed to resolve the newly attached tmux client")
    }
    this.targetClient = targetClient

    await this.writeWrapper(this.targetClient)
  }

  async cleanup(): Promise<void> {
    if (this.clientProcess) {
      try {
        this.clientProcess.kill("SIGTERM")
      } catch {}
      this.clientProcess = null
    }

    try {
      this.execTmux(["kill-server"])
    } catch {}
  }

  execTmux(args: string[]): string {
    return execFileSync(this.realTmuxPath, ["-L", this.server, ...args], {
      encoding: "utf-8",
      stdio: "pipe",
      env: this.env,
    })
  }

  async markLog(): Promise<number> {
    return (await this.readLog()).length
  }

  async readLog(): Promise<string> {
    return await fsp.readFile(this.logPath, "utf-8").catch(() => "")
  }

  async waitForLog(
    pattern: string,
    timeoutMs: number = 5000,
    afterOffset: number = 0
  ): Promise<void> {
    await poll(
      async () => (await this.readLog()).slice(afterOffset),
      (value) => value.includes(pattern),
      timeoutMs,
      `client log to include "${pattern}"`
    )
  }

  async sendClientInput(input: string): Promise<void> {
    if (!this.clientProcess?.stdin || this.clientProcess.stdin.destroyed) {
      throw new Error("tmux client stdin is unavailable")
    }

    const payload = encodeClientInput(input)
    await new Promise<void>((resolve, reject) => {
      this.clientProcess!.stdin!.write(payload, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    await sleep(200)
  }

  getClientTarget(): string {
    return this.targetClient
  }

  private async writeWrapper(targetClient?: string) {
    const displayPopupPrefix = targetClient
      ? `if [ "$1" = "display-popup" ]; then\n  shift\n  exec "${this.realTmuxPath}" -L "${this.server}" display-popup -c "${targetClient}" "$@"\nfi\n`
      : ""

    await fsp.writeFile(
      this.wrapperPath,
      `#!/bin/sh\n${displayPopupPrefix}exec "${this.realTmuxPath}" -L "${this.server}" "$@"\n`
    )
    await fsp.chmod(this.wrapperPath, 0o755)
  }

  private async writeBridge() {
    await fsp.writeFile(
      this.bridgePath,
      `#!/usr/bin/env python3
import os
import pty
import selectors
import sys

log_path, tmux_path, server, session = sys.argv[1:5]

pid, fd = pty.fork()
if pid == 0:
    os.execvp(tmux_path, [tmux_path, "-L", server, "attach-session", "-t", session])

selector = selectors.DefaultSelector()
selector.register(fd, selectors.EVENT_READ)

stdin_open = True
try:
    os.set_blocking(sys.stdin.fileno(), False)
    selector.register(sys.stdin, selectors.EVENT_READ)
except Exception:
    stdin_open = False

with open(log_path, "ab", buffering=0) as log_file:
    os.set_blocking(fd, False)

    while True:
        for key, _ in selector.select(0.1):
            if stdin_open and key.fileobj is sys.stdin:
                try:
                    payload = os.read(sys.stdin.fileno(), 1024)
                except BlockingIOError:
                    continue

                if not payload:
                    stdin_open = False
                    try:
                        selector.unregister(sys.stdin)
                    except Exception:
                        pass
                    continue

                os.write(fd, payload)
                continue

            try:
                output = os.read(fd, 4096)
            except BlockingIOError:
                continue
            except OSError:
                output = b""

            if not output:
                waited_pid, status = os.waitpid(pid, os.WNOHANG)
                if waited_pid == pid:
                    raise SystemExit(os.waitstatus_to_exitcode(status))
                continue

            log_file.write(output)

        waited_pid, status = os.waitpid(pid, os.WNOHANG)
        if waited_pid == pid:
            raise SystemExit(os.waitstatus_to_exitcode(status))
`
    )
    await fsp.chmod(this.bridgePath, 0o755)
  }
}

export async function withAttachedTmuxClient(
  callback: (context: AttachedTmuxClientContext) => Promise<void>,
  options: {
    width?: number
    height?: number
    sessionName?: string
    rootPrefix?: string
    command?: string
  } = {}
) {
  const width = options.width ?? DEFAULT_CLIENT_WIDTH
  const height = options.height ?? DEFAULT_CLIENT_HEIGHT
  const sessionName = options.sessionName ?? "dmux-popup"
  const tmpDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), options.rootPrefix ?? "dmux-popup-")
  )
  const harness = new AttachedTmuxClientHarness(
    sessionName,
    width,
    height,
    tmpDir,
    {
      ...process.env,
      PATH: `${path.join(tmpDir, "bin")}:${process.env.PATH || ""}`,
    }
  )
  const originalPath = process.env.PATH

  try {
    process.env.PATH = `${harness.wrapperDir}:${originalPath || ""}`
    await harness.setup(options.command)

    await callback({
      tmpDir,
      artifactDir: harness.artifactDir,
      logPath: harness.logPath,
      width,
      height,
      writeScript: (name, body) => writeExecutableScript(tmpDir, name, body),
      createPopupManager: () => {
        const settingsManager = {
          getSettings: () => ({}),
          getGlobalSettings: () => ({}),
          getProjectSettings: () => ({}),
        }
        const config: PopupManagerConfig = {
          sidebarWidth: 40,
          projectRoot: "/repo-a",
          popupsSupported: true,
          isDevMode: true,
          terminalWidth: width,
          terminalHeight: height,
          availableAgents: ["claude", "codex"],
          settingsManager,
          getSettingsManagerForProjectRoot: () => settingsManager,
          projectSettings: {},
          trackProjectActivity: async (work: () => Promise<unknown>) => await work(),
        }

        return new PopupManager(config, () => {}, () => {})
      },
      waitForLog: (pattern, timeoutMs, afterOffset) =>
        harness.waitForLog(pattern, timeoutMs, afterOffset),
      readLog: () => harness.readLog(),
      markLog: () => harness.markLog(),
      sendClientInput: (input) => harness.sendClientInput(input),
    })
  } finally {
    process.env.PATH = originalPath
    await harness.cleanup()
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

export class DmuxRuntimeHarness {
  readonly runner: DmuxRunner
  readonly dmuxExecutablePath: string
  readonly tmpDir: string
  readonly artifactDir: string
  readonly wrapperDir: string
  readonly width: number
  readonly height: number
  readonly sessionName: string

  private readonly clientHarness: AttachedTmuxClientHarness
  private readonly additionalClientHarnesses: AttachedTmuxClientHarness[] = []
  private readonly projects = new Map<string, RuntimeProject>()
  private readonly env: NodeJS.ProcessEnv
  private readonly realTmuxPath: string
  private readonly failureSnapshots: string[] = []

  constructor(
    runner: DmuxRunner,
    rootDir: string,
    options: {
      width?: number
      height?: number
      sessionName?: string
    } = {}
  ) {
    this.runner = runner
    this.dmuxExecutablePath = path.join(process.cwd(), "dmux")
    this.tmpDir = rootDir
    this.artifactDir = path.join(rootDir, "artifacts")
    this.wrapperDir = path.join(rootDir, "bin")
    this.width = options.width ?? DEFAULT_CLIENT_WIDTH
    this.height = options.height ?? DEFAULT_CLIENT_HEIGHT
    this.sessionName = options.sessionName ?? "dmux-runtime"
    this.env = {
      ...process.env,
      HOME: path.join(rootDir, "home"),
      PATH: `${this.wrapperDir}:${process.env.PATH || ""}`,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "dmux-e2e-key",
    }
    this.clientHarness = new AttachedTmuxClientHarness(
      this.sessionName,
      this.width,
      this.height,
      rootDir,
      this.env
    )
    this.realTmuxPath = this.clientHarness.realTmuxPath
  }

  async setup(): Promise<void> {
    await fsp.mkdir(this.artifactDir, { recursive: true })
    await fsp.mkdir(this.wrapperDir, { recursive: true })
    await fsp.mkdir(this.env.HOME!, { recursive: true })
    await fsp.writeFile(path.join(this.env.HOME!, ".zshrc"), "# dmux e2e\n")
    await fsp.writeFile(path.join(this.env.HOME!, ".tmux.conf"), "# dmux e2e\n")
    await this.clientHarness.setup()
    this.execTmux([
      "respawn-pane",
      "-k",
      "-t",
      `${this.sessionName}:0.0`,
      `${process.env.SHELL || "sh"} -i`,
    ])
  }

  async cleanup(): Promise<void> {
    for (const harness of this.additionalClientHarnesses.splice(0)) {
      await harness.cleanup()
    }
    await this.clientHarness.cleanup()
  }

  async createProject(
    name: string,
    options: {
      presentationMode?: PresentationMode
      initialFiles?: Record<string, string>
    } = {}
  ): Promise<RuntimeProject> {
    const root = path.join(this.tmpDir, "projects", name)
    const dmuxDir = path.join(root, ".dmux")
    const configPath = path.join(dmuxDir, "dmux.config.json")
    const settingsPath = path.join(dmuxDir, "settings.json")

    await fsp.mkdir(root, { recursive: true })
    await fsp.writeFile(path.join(root, ".gitignore"), ".dmux/\n")
    await fsp.writeFile(path.join(root, "README.md"), `# ${name}\n`)

    if (options.initialFiles) {
      for (const [relativePath, content] of Object.entries(options.initialFiles)) {
        const targetPath = path.join(root, relativePath)
        await fsp.mkdir(path.dirname(targetPath), { recursive: true })
        await fsp.writeFile(targetPath, content)
      }
    }

    execFileSync("git", ["init", "-b", "main"], {
      cwd: root,
      env: { ...this.env, ...DEFAULT_COMMIT_ENV },
      stdio: "pipe",
    })
    execFileSync("git", ["config", "user.name", DEFAULT_COMMIT_ENV.GIT_AUTHOR_NAME], {
      cwd: root,
      env: { ...this.env, ...DEFAULT_COMMIT_ENV },
      stdio: "pipe",
    })
    execFileSync("git", ["config", "user.email", DEFAULT_COMMIT_ENV.GIT_AUTHOR_EMAIL], {
      cwd: root,
      env: { ...this.env, ...DEFAULT_COMMIT_ENV },
      stdio: "pipe",
    })
    execFileSync("git", ["add", "."], {
      cwd: root,
      env: { ...this.env, ...DEFAULT_COMMIT_ENV },
      stdio: "pipe",
    })
    execFileSync("git", ["commit", "-m", "Initial commit"], {
      cwd: root,
      env: { ...this.env, ...DEFAULT_COMMIT_ENV },
      stdio: "pipe",
    })

    await fsp.mkdir(dmuxDir, { recursive: true })
    if (options.presentationMode) {
      await fsp.writeFile(
        settingsPath,
        JSON.stringify({ presentationMode: options.presentationMode })
      )
    }

    const project = { name, root, configPath, settingsPath }
    this.projects.set(name, project)
    return project
  }

  async startDmux(project: RuntimeProject): Promise<void> {
    await this.sendPaneCommand(
      `${this.sessionName}:0.0`,
      `cd ${shellQuote(project.root)} && ${this.runner.cmd}`
    )

    await this.waitForDmuxReady(project)
  }

  async waitForDmuxReady(project: RuntimeProject): Promise<void> {
    await poll(
      async () => (await this.getControlPaneId()) || "",
      (value) => value.length > 0,
      20000,
      "dmux control pane"
    )
    await poll(
      async () => !!(await this.readConfig(project))?.controlPaneId,
      Boolean,
      20000,
      `${project.name} config initialization`
    )
    await this.waitForControlPaneReady()
  }

  async attachProject(
    project: RuntimeProject,
    options: {
      paneId?: string
    } = {}
  ): Promise<void> {
    const targetPaneId = options.paneId || await this.getActivePaneId()
    const sessionProject = this.getSessionProject()

    await this.sendPaneCommand(
      targetPaneId,
      `cd ${shellQuote(project.root)} && ${this.runner.cmd}`
    )
    await sleep(500)
    await this.sendPaneInput(targetPaneId, "Enter")

    await poll(
      async () => {
        const config = await this.readConfig(sessionProject)
        return config?.sidebarProjects?.some(
          (sidebarProject) =>
            normalizePathForComparison(sidebarProject.projectRoot)
            === normalizePathForComparison(project.root)
        ) === true
      },
      Boolean,
      10000,
      `project ${project.name} to be attached`
    )
  }

  async getControlPaneId(): Promise<string | null> {
    try {
      const value = this.execTmux([
        "show-options",
        "-v",
        "-t",
        this.sessionName,
        CONTROL_PANE_OPTION,
      ]).trim()

      return value || null
    } catch {
      return null
    }
  }

  async getActivePaneId(): Promise<string> {
    return this.execTmux([
      "display-message",
      "-p",
      "-t",
      `${this.sessionName}:0`,
      "#{pane_id}",
    ]).trim()
  }

  async listClientTargets(): Promise<string[]> {
    return (await this.listClients()).map((client) => client.tty)
  }

  async listClients(): Promise<RuntimeTmuxClient[]> {
    return this.execTmux([
      "list-clients",
      "-F",
      "#{client_tty}\t#{client_key_table}",
    ])
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((line) => {
        const [tty = "", keyTable = ""] = line.split("\t")
        return {
          tty,
          keyTable: keyTable || "root",
        }
      })
  }

  async getPaneSnapshots(): Promise<TmuxPaneSnapshot[]> {
    const output = this.execTmux([
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_id}\t#{pane_active}\t#{window_zoomed_flag}\t#{pane_title}",
    ])

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sessionName, windowIndex, paneIndex, paneId, active, zoomed, title] = line.split("\t")
        return {
          sessionName,
          windowIndex: Number(windowIndex),
          paneIndex: Number(paneIndex),
          paneId,
          active: active === "1",
          zoomed: zoomed === "1",
          title,
        }
      })
  }

  async waitForControlPaneReady(): Promise<void> {
    await poll(
      async () => {
        const [capture, clientLog] = await Promise.all([
          this.readControlPaneCapture(),
          this.readClientLog(),
        ])
        return { capture, clientLog }
      },
      ({ capture, clientLog }) => {
        const text = `${capture}\n${clientLog}`
        return (
          text.includes("[t]erminal")
          || text.includes("[n]ew agent")
          || text.includes("[Setup] Setting initial control pane ID")
        )
      },
      20000,
      "dmux control pane to become interactive"
    )
    await sleep(500)
  }

  async readControlPaneCapture(): Promise<string> {
    const controlPaneId = await this.getControlPaneId()
    if (!controlPaneId) {
      return ""
    }

    return this.execTmux(["capture-pane", "-p", "-t", controlPaneId])
  }

  async readPaneCapture(paneId: string): Promise<string> {
    return this.execTmux(["capture-pane", "-p", "-J", "-t", paneId])
  }

  async readConfig(project: RuntimeProject): Promise<DmuxConfig | null> {
    try {
      return JSON.parse(await fsp.readFile(project.configPath, "utf-8")) as DmuxConfig
    } catch {
      return null
    }
  }

  async waitForPaneCount(project: RuntimeProject, count: number): Promise<DmuxConfig> {
    return await poll(
      async () => await this.readConfig(project),
      (config): config is DmuxConfig => !!config && config.panes.length === count,
      15000,
      `${project.name} to have ${count} panes`
    )
  }

  async waitForPaneState(
    project: RuntimeProject,
    predicate: (config: DmuxConfig) => boolean,
    description: string
  ): Promise<DmuxConfig> {
    return await poll(
      async () => await this.readConfig(project),
      (config): config is DmuxConfig => !!config && predicate(config),
      15000,
      description
    )
  }

  async sendControlInput(input: string): Promise<void> {
    const controlPaneId = await this.getControlPaneId()
    if (!controlPaneId) {
      throw new Error("dmux control pane is unavailable")
    }
    await this.sendPaneInput(controlPaneId, input)
  }

  async sendPaneCommand(target: string, command: string): Promise<void> {
    await this.sendPaneInput(target, command)
    await this.sendPaneInput(target, "Enter")
  }

  async sendActiveWorkPaneCommand(command: string): Promise<void> {
    await this.sendPaneCommand(await this.getActivePaneId(), command)
  }

  async splitPaneDirect(options: {
    cwd?: string
    targetPaneId?: string
    preserveZoom?: boolean
  } = {}): Promise<string> {
    const targetPaneId = options.targetPaneId || await this.getActivePaneId()
    const args = [
      "split-window",
      "-h",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      targetPaneId,
    ]

    if (options.preserveZoom !== false) {
      args.push("-Z")
    }

    if (options.cwd) {
      args.push("-c", options.cwd)
    }

    return this.execTmux(args).trim()
  }

  async selectPaneDirect(
    paneId: string,
    options: { preserveZoom?: boolean } = {}
  ): Promise<void> {
    const args = ["select-pane", "-t", paneId]
    if (options.preserveZoom) {
      args.push("-Z")
    }
    this.execTmux(args)
    await sleep(200)
  }

  async sendPaneInput(target: string, input: string): Promise<void> {
    this.sendKeysToTarget(["-t", target], input)
    await sleep(200)
  }

  async sendClientInput(input: string): Promise<void> {
    await this.clientHarness.sendClientInput(input)
  }

  async attachAdditionalClient(options: {
    width?: number
    height?: number
    id?: string
  } = {}): Promise<RuntimeAttachedClient> {
    const width = options.width ?? this.width
    const height = options.height ?? this.height
    const clientId = options.id ?? `client-${this.additionalClientHarnesses.length + 2}`
    const clientRootDir = path.join(this.tmpDir, clientId)
    const knownClients = await this.listClientTargets()

    const harness = new AttachedTmuxClientHarness(
      this.sessionName,
      width,
      height,
      clientRootDir,
      this.env,
      { server: this.clientHarness.server }
    )

    await harness.setup("sleep 100000", {
      createSession: false,
      knownClients,
    })

    this.additionalClientHarnesses.push(harness)

    return {
      tmpDir: clientRootDir,
      artifactDir: harness.artifactDir,
      logPath: harness.logPath,
      targetClient: harness.getClientTarget(),
      readLog: () => harness.readLog(),
      markLog: () => harness.markLog(),
      waitForLog: (pattern, timeoutMs, afterOffset) =>
        harness.waitForLog(pattern, timeoutMs, afterOffset),
      sendInput: (input) => harness.sendClientInput(input),
    }
  }

  async openPaneMenuFromActivePane(): Promise<void> {
    const afterOffset = await this.markClientLog()
    await this.sendActiveWorkPaneCommand(
      `${shellQuote(this.dmuxExecutablePath)} --remote-pane-action m >/dev/null 2>&1`
    )
    await this.waitForClientLog("Menu:", 10000, afterOffset)
    await this.waitForClientLog("Enter or hotkey select", 10000, afterOffset)
    await sleep(200)
  }

  async markClientLog(): Promise<number> {
    return await this.clientHarness.markLog()
  }

  async waitForClientLog(
    pattern: string,
    timeoutMs: number = 5000,
    afterOffset: number = 0
  ): Promise<void> {
    await this.clientHarness.waitForLog(pattern, timeoutMs, afterOffset)
  }

  async readClientLog(): Promise<string> {
    return await this.clientHarness.readLog()
  }

  async captureArtifacts(label: string): Promise<RuntimeArtifactSnapshot> {
    const artifactDir = path.join(this.artifactDir, label)
    await fsp.mkdir(artifactDir, { recursive: true })

    const sessionsPath = path.join(artifactDir, "sessions.txt")
    const windowsPath = path.join(artifactDir, "windows.txt")
    const panesPath = path.join(artifactDir, "panes.txt")
    await fsp.writeFile(
      sessionsPath,
      this.execTmux(["list-sessions"]).trim()
    )
    await fsp.writeFile(
      windowsPath,
      this.execTmux(["list-windows", "-a"]).trim()
    )
    await fsp.writeFile(
      panesPath,
      this.execTmux([
        "list-panes",
        "-a",
        "-F",
        "#{session_name}:#{window_index}.#{pane_index} #{pane_id} active=#{pane_active} zoom=#{window_zoomed_flag} title=#{pane_title}",
      ]).trim()
    )

    const configPaths: string[] = []
    for (const project of Array.from(this.projects.values())) {
      const outputPath = path.join(artifactDir, `${project.name}.dmux.config.json`)
      configPaths.push(outputPath)
      try {
        await fsp.copyFile(project.configPath, outputPath)
      } catch {
        await fsp.writeFile(outputPath, "")
      }
    }

    let controlPaneCapturePath: string | undefined
    const controlPaneId = await this.getControlPaneId()
    if (controlPaneId) {
      controlPaneCapturePath = path.join(artifactDir, "control-pane.txt")
      await fsp.writeFile(
        controlPaneCapturePath,
        this.execTmux(["capture-pane", "-p", "-t", controlPaneId])
      )
    }

    let activePaneCapturePath: string | undefined
    try {
      const activePaneId = await this.getActivePaneId()
      activePaneCapturePath = path.join(artifactDir, "active-pane.txt")
      await fsp.writeFile(
        activePaneCapturePath,
        this.execTmux(["capture-pane", "-p", "-t", activePaneId])
      )
    } catch {}

    const clientLogPath = path.join(artifactDir, "client.log")
    await fsp.copyFile(this.clientHarness.logPath, clientLogPath).catch(async () => {
      await fsp.writeFile(clientLogPath, "")
    })

    this.failureSnapshots.push(artifactDir)

    return {
      artifactDir,
      sessionsPath,
      windowsPath,
      panesPath,
      clientLogPath,
      controlPaneCapturePath,
      activePaneCapturePath,
      configPaths,
    }
  }

  getFailureSnapshotPaths(): string[] {
    return [...this.failureSnapshots]
  }

  getClientTarget(): string {
    return this.clientHarness.getClientTarget()
  }

  getSessionProject(): RuntimeProject {
    const sessionProject = this.projects.get("repo-a") || Array.from(this.projects.values())[0]
    if (!sessionProject) {
      throw new Error("No session project has been created")
    }
    return sessionProject
  }

  private execTmux(args: string[]): string {
    return execFileSync(this.realTmuxPath, ["-L", this.clientHarness.server, ...args], {
      encoding: "utf-8",
      stdio: "pipe",
      env: this.env,
    })
  }

  private sendKeysToTarget(targetArgs: string[], input: string) {
    if (TMUX_SPECIAL_KEYS.has(input)) {
      this.execTmux(["send-keys", ...targetArgs, input])
      return
    }

    if (input.length === 1) {
      this.execTmux(["send-keys", ...targetArgs, input])
      return
    }

    this.execTmux(["send-keys", ...targetArgs, "-l", input])
  }
}

export async function withDmuxRuntimeHarness(
  callback: (harness: DmuxRuntimeHarness) => Promise<void>,
  options: {
    width?: number
    height?: number
    sessionName?: string
  } = {}
) {
  const runner = detectDmuxRunner()
  if (!runner) {
    throw new Error("Unable to detect a dmux runtime runner")
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "dmux-runtime-"))
  const harness = new DmuxRuntimeHarness(runner, tmpDir, options)

  try {
    await harness.setup()
    await callback(harness)
  } catch (error) {
    const snapshot = await harness.captureArtifacts("failure")
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\nArtifacts: ${snapshot.artifactDir}`)
  } finally {
    await harness.cleanup()
    if (harness.getFailureSnapshotPaths().length === 0) {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export function computeLegacyPanesFilePath(projectRoot: string, homeDir: string): string {
  const projectName = path.basename(projectRoot)
  const projectHash = createHash("md5").update(projectRoot).digest("hex").substring(0, 8)
  const projectIdentifier = `${projectName}-${projectHash}`
  return path.join(homeDir, ".dmux", `${projectIdentifier}-panes.json`)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
