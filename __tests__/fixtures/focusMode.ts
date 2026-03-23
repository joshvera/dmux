import type { DmuxPane, SidebarProject } from "../../src/types.js"

interface CreateFocusModeFixtureOptions {
  includeRunningProcess?: boolean
}

function createFocusPane(
  id: string,
  projectRoot: string,
  displayName: string,
  overrides: Partial<DmuxPane> = {}
): DmuxPane {
  const slug = displayName.toLowerCase().replace(/\s+/g, "-")

  return {
    id,
    slug,
    displayName,
    prompt: displayName,
    paneId: `%${id.replace(/^dmux-/, "")}`,
    projectRoot,
    projectName: projectRoot.split("/").pop(),
    worktreePath: `${projectRoot}/.dmux/worktrees/${slug}`,
    type: "worktree",
    autopilot: false,
    ...overrides,
  }
}

export function createCanonicalFocusModeFixture(
  options: CreateFocusModeFixtureOptions = {}
): {
  panes: DmuxPane[]
  sidebarProjects: SidebarProject[]
  sessionProjectRoot: string
  sessionProjectName: string
  selectedPane: DmuxPane
  sameProjectVisiblePane: DmuxPane
  sameProjectHiddenPane: DmuxPane
  otherProjectVisiblePane: DmuxPane
  otherProjectHiddenPane: DmuxPane
  emptySidebarProject: SidebarProject
} {
  const sessionProjectRoot = "/repo-a"
  const sessionProjectName = "repo-a"
  const selectedPane = createFocusPane("dmux-1", "/repo-a", "Alpha One", {
    testWindowId: options.includeRunningProcess ? "@1" : undefined,
  })
  const sameProjectVisiblePane = createFocusPane("dmux-2", "/repo-a", "Alpha Two")
  const sameProjectHiddenPane = createFocusPane(
    "dmux-3",
    "/repo-a",
    "Alpha Hidden",
    { hidden: true }
  )
  const otherProjectVisiblePane = createFocusPane("dmux-4", "/repo-b", "Beta One")
  const otherProjectHiddenPane = createFocusPane(
    "dmux-5",
    "/repo-b",
    "Beta Hidden",
    { hidden: true }
  )

  const emptySidebarProject = {
    projectRoot: "/repo-empty",
    projectName: "repo-empty",
  }

  return {
    panes: [
      selectedPane,
      sameProjectVisiblePane,
      sameProjectHiddenPane,
      otherProjectVisiblePane,
      otherProjectHiddenPane,
    ],
    sidebarProjects: [
      { projectRoot: "/repo-a", projectName: "repo-a" },
      { projectRoot: "/repo-b", projectName: "repo-b" },
      emptySidebarProject,
    ],
    sessionProjectRoot,
    sessionProjectName,
    selectedPane,
    sameProjectVisiblePane,
    sameProjectHiddenPane,
    otherProjectVisiblePane,
    otherProjectHiddenPane,
    emptySidebarProject,
  }
}
