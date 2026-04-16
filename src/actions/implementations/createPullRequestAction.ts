import type { DmuxPane } from '../../types.js';
import type { ActionContext, ActionResult } from '../types.js';
import { handleCommitWithOptions } from '../merge/commitMessageHandler.js';
import { getPaneBranchName } from '../../utils/git.js';
import { getGitStatus, hasCommitsToMerge } from '../../utils/mergeValidation.js';
import {
  resolveMergeTarget,
  type MergeTargetResolution,
} from '../../utils/mergeTargets.js';
import { createGitHubPullRequest } from '../../utils/githubPullRequest.js';
import { getPaneDisplayName } from '../../utils/paneTitle.js';
import {
  generatePRSummary,
  getBranchDiff,
  formatPRSummary,
  parsePRSummary,
} from '../../utils/prSummary.js';
import { LogService } from '../../services/LogService.js';

function buildFallbackPullRequestMessage(
  paneName: string,
  mergeTarget: MergeTargetResolution
): string {
  const parentLabel = mergeTarget.fallbackFrom
    ? mergeTarget.fallbackFrom.displayName || mergeTarget.fallbackFrom.slug || mergeTarget.fallbackFrom.branchName
    : 'the original parent worktree';

  if (mergeTarget.fallbackReason === 'merged') {
    return `"${parentLabel}" has already been merged upstream. Create a pull request for "${paneName}" into ${mergeTarget.targetLabel} instead?`;
  }

  if (mergeTarget.fallbackReason === 'branch_changed') {
    return `"${parentLabel}" is no longer checked out on its expected branch. Create a pull request for "${paneName}" into ${mergeTarget.targetLabel} instead?`;
  }

  return `"${parentLabel}" is no longer available. Create a pull request for "${paneName}" into ${mergeTarget.targetLabel} instead?`;
}

function buildMissingPullRequestTargetMessage(paneName: string): string {
  return `Unable to find a valid pull request target for "${paneName}". Reopen its parent worktree or check out the expected target branch before creating a pull request.`;
}

async function handlePullRequestUncommitted(
  pane: DmuxPane,
  mergeTarget: MergeTargetResolution,
  retryCreatePullRequest: () => Promise<ActionResult>
): Promise<ActionResult> {
  const status = getGitStatus(pane.worktreePath!);

  return {
    type: 'choice',
    title: 'Worktree Has Uncommitted Changes',
    message: 'This worktree has uncommitted changes that must be committed before creating a pull request.',
    options: [
      {
        id: 'commit_automatic',
        label: 'AI commit (automatic)',
        description: 'Auto-generate and commit immediately',
        default: true,
      },
      {
        id: 'commit_ai_editable',
        label: 'AI commit (editable)',
        description: 'Generate message from diff, edit before commit',
      },
      {
        id: 'commit_manual',
        label: 'Manual commit message',
        description: 'Write your own commit message',
      },
      {
        id: 'cancel',
        label: 'Cancel PR',
        description: 'Resolve manually later',
      },
    ],
    data: {
      kind: 'merge_uncommitted',
      repoPath: pane.worktreePath!,
      targetBranch: mergeTarget.targetBranch,
      files: status.files,
      diffMode: 'target-branch',
    },
    onSelect: async (optionId: string) => {
      if (optionId === 'cancel') {
        return {
          type: 'info',
          message: 'Pull request cancelled',
          dismissable: true,
        };
      }

      if (
        optionId === 'commit_automatic'
        || optionId === 'commit_ai_editable'
        || optionId === 'commit_manual'
      ) {
        return handleCommitWithOptions(
          pane.worktreePath!,
          optionId as 'commit_automatic' | 'commit_ai_editable' | 'commit_manual',
          retryCreatePullRequest
        );
      }

      return {
        type: 'info',
        message: 'Unknown option',
        dismissable: true,
      };
    },
    dismissable: true,
  };
}

function buildCreatePullRequestConfirmation(
  paneName: string,
  mergeTarget: MergeTargetResolution,
  onConfirm: () => Promise<ActionResult>
): ActionResult {
  return {
    type: 'confirm',
    title: 'Create Pull Request',
    message: `Push "${paneName}" and create a GitHub pull request into ${mergeTarget.targetLabel}?`,
    confirmLabel: 'Create PR',
    cancelLabel: 'Cancel',
    onConfirm,
    onCancel: async () => ({
      type: 'info',
      message: 'Pull request cancelled',
      dismissable: true,
    }),
  };
}

function buildFallbackPullRequestConfirmation(
  paneName: string,
  mergeTarget: MergeTargetResolution,
  onConfirm: () => Promise<ActionResult>
): ActionResult {
  return {
    type: 'confirm',
    title: 'Parent PR Target Unavailable',
    message: buildFallbackPullRequestMessage(paneName, mergeTarget),
    confirmLabel: 'Create PR',
    cancelLabel: 'Cancel',
    onConfirm,
    onCancel: async () => ({
      type: 'info',
      message: 'Pull request cancelled',
      dismissable: true,
    }),
  };
}

export async function createPullRequest(
  pane: DmuxPane,
  context: ActionContext
): Promise<ActionResult> {
  const paneName = getPaneDisplayName(pane);

  if (!pane.worktreePath) {
    return {
      type: 'error',
      message: 'This pane has no worktree to create a pull request from',
      dismissable: true,
    };
  }

  const mergeTarget = resolveMergeTarget(pane);
  if (!mergeTarget) {
    return {
      type: 'error',
      message: buildMissingPullRequestTargetMessage(paneName),
      dismissable: true,
    };
  }

  const sourceBranch = getPaneBranchName(pane);
  const worktreeStatus = getGitStatus(pane.worktreePath);
  const hasCommits = hasCommitsToMerge(
    pane.worktreePath,
    sourceBranch,
    mergeTarget.targetBranch
  );

  if (worktreeStatus.hasChanges) {
    return handlePullRequestUncommitted(
      pane,
      mergeTarget,
      () => createPullRequest(pane, context)
    );
  }

  if (!hasCommits) {
    return {
      type: 'info',
      message: `No committed changes to include in a pull request for "${paneName}"`,
      dismissable: true,
    };
  }

  const submitWithSummary = async (
    title: string | undefined,
    body: string | undefined
  ): Promise<ActionResult> => {
    try {
      const result = createGitHubPullRequest({
        repoPath: pane.worktreePath!,
        sourceBranch,
        targetBranch: mergeTarget.targetBranch,
        title,
        body,
      });

      return {
        type: 'success',
        message: result.created
          ? `Created PR: ${result.url}`
          : `PR already exists: ${result.url}`,
        dismissable: true,
      };
    } catch (error) {
      return {
        type: 'error',
        message: `Failed to create pull request: ${error instanceof Error ? error.message : String(error)}`,
        dismissable: true,
      };
    }
  };

  const buildSummaryReviewInput = (
    defaultValue: string,
    diffSummary: string,
    aiFailed: boolean
  ): ActionResult => {
    const header = aiFailed
      ? '⚠️ AI summary generation failed. Write a title (first line), blank line, then markdown body.'
      : 'Review the AI-generated PR summary. First line is the title; blank line; then body.';
    const filesNote = diffSummary.trim()
      ? `\n\nFiles changed:\n${diffSummary.trim()}`
      : '';

    return {
      type: 'input',
      title: 'PR Title & Description',
      message: `${header}${filesNote}`,
      placeholder: 'feat: short title\n\n## Summary\n- ...',
      defaultValue,
      onSubmit: async (value: string) => {
        const { title, body } = parsePRSummary(value);
        if (!title) {
          return {
            type: 'error',
            message: 'PR title cannot be empty',
            dismissable: true,
          };
        }
        return submitWithSummary(title, body);
      },
      dismissable: true,
    };
  };

  const submitPullRequest = async (): Promise<ActionResult> => {
    try {
      const generated = await generatePRSummary(
        pane.worktreePath!,
        sourceBranch,
        mergeTarget.targetBranch
      );

      if (generated) {
        const { summary } = getBranchDiff(
          pane.worktreePath!,
          sourceBranch,
          mergeTarget.targetBranch
        );
        return buildSummaryReviewInput(formatPRSummary(generated), summary, false);
      }

      LogService.getInstance().warn(
        'AI PR summary generation returned null; falling back to --fill',
        'createPullRequestAction'
      );
      return submitWithSummary(undefined, undefined);
    } catch (error) {
      LogService.getInstance().error(
        `AI PR summary generation error: ${error}`,
        'createPullRequestAction',
        undefined,
        error instanceof Error ? error : undefined
      );
      return submitWithSummary(undefined, undefined);
    }
  };

  if (mergeTarget.requiresConfirmation) {
    return buildFallbackPullRequestConfirmation(
      paneName,
      mergeTarget,
      submitPullRequest
    );
  }

  return buildCreatePullRequestConfirmation(
    paneName,
    mergeTarget,
    submitPullRequest
  );
}
