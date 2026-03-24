import { describe, expect, it, vi } from "vitest"
import { createCanonicalFocusModeFixture } from "./fixtures/focusMode.js"
import {
  applyBulkVisibilityToggle,
  applyPaneVisibilityToggle,
  applyProjectVisibilityToggle,
} from "../src/utils/paneVisibilityMutations.js"
import type { DmuxPane } from "../src/types.js"

function clonePanes(panes: DmuxPane[]): DmuxPane[] {
  return panes.map((pane) => ({ ...pane }))
}

function createMutationHarness(initialPanes: DmuxPane[]) {
  let currentPanes = clonePanes(initialPanes)
  const tmuxService = {
    joinPaneToTarget: vi.fn(async () => {}),
    breakPaneToWindow: vi.fn(async () => "@1"),
  }
  const savePanes = vi.fn(async (updatedPanes: DmuxPane[]) => {
    currentPanes = updatedPanes.map((pane) => ({ ...pane }))
  })
  const loadPanes = vi.fn(async () => {})
  const refreshPaneLayout = vi.fn(async () => {})
  const getPaneShowTarget = vi.fn(async (excludedPaneId?: string) =>
    currentPanes.find((pane) => !pane.hidden && pane.paneId !== excludedPaneId)?.paneId || null
  )

  return {
    tmuxService,
    savePanes,
    loadPanes,
    refreshPaneLayout,
    getPaneShowTarget,
    getCurrentPanes: () => currentPanes.map((pane) => ({ ...pane })),
    buildDeps: () => ({
      panes: currentPanes.map((pane) => ({ ...pane })),
      tmuxService,
      getPaneShowTarget,
      savePanes,
      loadPanes,
      refreshPaneLayout,
    }),
  }
}

describe("paneVisibilityMutations", () => {
  it("hides a visible pane and updates hidden state", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const harness = createMutationHarness(fixture.panes)

    const result = await applyPaneVisibilityToggle(
      harness.buildDeps(),
      fixture.selectedPane
    )

    expect(harness.tmuxService.breakPaneToWindow).toHaveBeenCalledWith(
      fixture.selectedPane.paneId,
      `dmux-hidden-${fixture.selectedPane.id}`
    )
    expect(result.hidden).toBe(true)
    expect(
      harness.getCurrentPanes().find((pane) => pane.id === fixture.selectedPane.id)?.hidden
    ).toBe(true)
    expect(harness.savePanes).toHaveBeenCalledOnce()
    expect(harness.loadPanes).toHaveBeenCalledOnce()
    expect(harness.refreshPaneLayout).toHaveBeenCalledOnce()
  })

  it("shows a hidden pane and updates hidden state", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const harness = createMutationHarness(fixture.panes)

    const result = await applyPaneVisibilityToggle(
      harness.buildDeps(),
      fixture.sameProjectHiddenPane
    )

    expect(harness.tmuxService.joinPaneToTarget).toHaveBeenCalledWith(
      fixture.sameProjectHiddenPane.paneId,
      fixture.selectedPane.paneId
    )
    expect(result.hidden).toBe(false)
    expect(
      harness.getCurrentPanes().find((pane) => pane.id === fixture.sameProjectHiddenPane.id)?.hidden
    ).toBe(false)
  })

  it("hides all visible non-selected panes for hide-others", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const harness = createMutationHarness(fixture.panes)

    const result = await applyBulkVisibilityToggle(
      harness.buildDeps(),
      fixture.selectedPane
    )

    expect(result?.action).toBe("hide-others")
    expect(result?.targetPanes.map((pane) => pane.id)).toEqual([
      fixture.sameProjectVisiblePane.id,
      fixture.otherProjectVisiblePane.id,
    ])
    expect(harness.tmuxService.breakPaneToWindow).toHaveBeenCalledTimes(2)
    expect(
      harness.getCurrentPanes().filter((pane) => !pane.hidden).map((pane) => pane.id)
    ).toEqual([fixture.selectedPane.id])
  })

  it("shows all hidden non-selected panes for show-others", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const allOthersHidden = clonePanes(fixture.panes).map((pane) =>
      pane.id === fixture.selectedPane.id ? pane : { ...pane, hidden: true }
    )
    const harness = createMutationHarness(allOthersHidden)

    const result = await applyBulkVisibilityToggle(
      harness.buildDeps(),
      { ...fixture.selectedPane, hidden: false }
    )

    expect(result?.action).toBe("show-others")
    expect(result?.targetPanes).toHaveLength(4)
    expect(harness.tmuxService.joinPaneToTarget).toHaveBeenCalledTimes(4)
    expect(
      harness.getCurrentPanes().filter((pane) => !pane.hidden).map((pane) => pane.id)
    ).toEqual([
      fixture.selectedPane.id,
      fixture.sameProjectVisiblePane.id,
      fixture.sameProjectHiddenPane.id,
      fixture.otherProjectVisiblePane.id,
      fixture.otherProjectHiddenPane.id,
    ])
  })

  it("focuses a project by revealing its hidden panes and hiding visible other-project panes", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const harness = createMutationHarness(fixture.panes)

    const result = await applyProjectVisibilityToggle(
      harness.buildDeps(),
      fixture.selectedPane.projectRoot!,
      fixture.sessionProjectRoot
    )

    expect(result?.action).toBe("focus-project")
    expect(result?.panesToShow.map((pane) => pane.id)).toEqual([
      fixture.sameProjectHiddenPane.id,
    ])
    expect(result?.panesToHide.map((pane) => pane.id)).toEqual([
      fixture.otherProjectVisiblePane.id,
    ])
    expect(harness.tmuxService.joinPaneToTarget).toHaveBeenCalledWith(
      fixture.sameProjectHiddenPane.paneId,
      fixture.selectedPane.paneId
    )
    expect(harness.tmuxService.breakPaneToWindow).toHaveBeenCalledWith(
      fixture.otherProjectVisiblePane.paneId,
      `dmux-hidden-${fixture.otherProjectVisiblePane.id}`
    )
    expect(
      harness.getCurrentPanes().filter((pane) => !pane.hidden).map((pane) => pane.id)
    ).toEqual([
      fixture.selectedPane.id,
      fixture.sameProjectVisiblePane.id,
      fixture.sameProjectHiddenPane.id,
    ])
  })

  it("shows all panes when the selected project is already focused", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const focusedProjectPanes = clonePanes(fixture.panes).map((pane) => {
      if (pane.id === fixture.sameProjectHiddenPane.id) {
        return { ...pane, hidden: false }
      }
      if (
        pane.id === fixture.otherProjectVisiblePane.id
        || pane.id === fixture.otherProjectHiddenPane.id
      ) {
        return { ...pane, hidden: true }
      }
      return pane
    })
    const harness = createMutationHarness(focusedProjectPanes)

    const result = await applyProjectVisibilityToggle(
      harness.buildDeps(),
      fixture.selectedPane.projectRoot!,
      fixture.sessionProjectRoot
    )

    expect(result?.action).toBe("show-all")
    expect(result?.panesToShow.map((pane) => pane.id)).toEqual([
      fixture.otherProjectVisiblePane.id,
      fixture.otherProjectHiddenPane.id,
    ])
    expect(result?.panesToHide).toHaveLength(0)
    expect(harness.tmuxService.joinPaneToTarget).toHaveBeenCalledTimes(2)
    expect(
      harness.getCurrentPanes().every((pane) => pane.hidden !== true)
    ).toBe(true)
  })
})
