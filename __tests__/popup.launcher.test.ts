import { EventEmitter } from "events"
import { beforeEach, describe, expect, it, vi } from "vitest"

const popupState = vi.hoisted(() => {
  const state = {
    readyExists: false,
    resultExists: false,
    resultData: "",
    child: null as (EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> }) | null,
    spawn: vi.fn(),
    existsSync: vi.fn((filePath: string) => {
      if (filePath.includes("dmux-popup-ready-")) {
        return state.readyExists
      }
      if (filePath.includes("dmux-popup-")) {
        return state.resultExists
      }
      return false
    }),
    unlinkSync: vi.fn((filePath: string) => {
      if (filePath.includes("dmux-popup-ready-")) {
        state.readyExists = false
      }
      if (filePath.includes("dmux-popup-")) {
        state.resultExists = false
      }
    }),
    readFileSync: vi.fn(() => state.resultData),
  }

  return state
})

vi.mock("child_process", () => ({
  spawn: popupState.spawn,
}))

vi.mock("fs", () => ({
  existsSync: popupState.existsSync,
  unlinkSync: popupState.unlinkSync,
  readFileSync: popupState.readFileSync,
}))

vi.mock("../src/services/TmuxService.js", () => ({
  TmuxService: {
    getInstance: () => ({
      getTerminalDimensionsSync: () => ({ width: 120, height: 40 }),
    }),
  },
}))

import { launchNodePopupNonBlocking } from "../src/utils/popup.js"

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = 4242
  child.kill = vi.fn()
  return child
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("launchNodePopupNonBlocking", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    popupState.readyExists = false
    popupState.resultExists = false
    popupState.resultData = ""
    popupState.child = createFakeChild()
    popupState.spawn.mockReset()
    popupState.spawn.mockReturnValue(popupState.child)
    popupState.existsSync.mockClear()
    popupState.unlinkSync.mockClear()
    popupState.readFileSync.mockClear()
  })

  it("returns an error when the popup exits before ready without a result file", async () => {
    const handle = launchNodePopupNonBlocking("/tmp/test-popup.js")

    popupState.child?.emit("close", 1, null)
    await vi.advanceTimersByTimeAsync(125)
    await flushMicrotasks()

    await expect(handle.readyPromise).resolves.toBeUndefined()
    await expect(handle.resultPromise).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/Popup exited before ready \(code 1\)/),
    })
  })

  it("returns a normal cancellation when the popup had already become ready", async () => {
    const handle = launchNodePopupNonBlocking("/tmp/test-popup.js")

    popupState.readyExists = true
    await vi.advanceTimersByTimeAsync(25)
    await flushMicrotasks()

    popupState.child?.emit("close", 0, null)
    await vi.advanceTimersByTimeAsync(125)
    await flushMicrotasks()

    await expect(handle.readyPromise).resolves.toBeUndefined()
    await expect(handle.resultPromise).resolves.toEqual({
      success: false,
      cancelled: true,
    })
  })
})
