import { LogService } from '../services/LogService.js';
import { TmuxService } from '../services/TmuxService.js';
import { generateSidebarGridLayout } from '../utils/tmux.js';
import type { LayoutConfig } from '../utils/layoutManager.js';
import type { LayoutConfiguration } from './LayoutCalculator.js';

/**
 * TmuxLayoutApplier - Applies calculated layouts to tmux
 *
 * Responsibilities:
 * - Set tmux window dimensions
 * - Generate and apply tmux layout strings
 * - Handle layout application failures with fallbacks
 * - Resize control pane (sidebar)
 *
 * Does NOT:
 * - Calculate layouts (use LayoutCalculator)
 * - Manage spacer panes (use SpacerManager)
 * - Determine when layouts need recalculation
 */
export class TmuxLayoutApplier {
  private tmuxService = TmuxService.getInstance();

  constructor(private config: LayoutConfig) {}

  /**
   * Sets tmux window dimensions to match calculated layout
   *
   * Accounts for status bar height to prevent terminal scrolling.
   * Only resizes if dimensions have actually changed to prevent resize loops.
   *
   * @param width - Desired window width in cells
   * @param height - Desired terminal height in cells (will subtract status bar)
   */
  async setWindowDimensions(width: number, height: number): Promise<void> {
    try {
      // Subtract status bar height from the provided terminal height
      const statusBarHeight = await this.tmuxService.getStatusBarHeight();
      const windowHeight = height - statusBarHeight;

      // Check if dimensions have actually changed
      const currentDims = await this.tmuxService.getWindowDimensions();
      if (currentDims.width === width && currentDims.height === windowHeight) {
        // Dimensions already correct, skip resize to prevent loops
        return;
      }

      // Use manual mode to constrain width, but also set height to match terminal
      await this.tmuxService.setWindowOption('window-size', 'manual');
      await this.tmuxService.resizeWindow({ width, height: windowHeight });
    } catch (error) {
      // Log but don't fail - some tmux versions may not support this
      LogService.getInstance().warn(
        `Could not set window dimensions to ${width}x${height}: ${error}`,
        'Layout'
      );
    }
  }

  /**
   * Applies the calculated layout to tmux panes
   *
   * Strategy:
   * 1. Generate custom layout string using sidebar grid algorithm
   * 2. Apply layout via tmux select-layout
   * 3. Fallback to main-vertical if custom layout fails
   * 4. Ultimate fallback: just resize sidebar
   *
   * @param controlPaneId - ID of sidebar/control pane
   * @param contentPaneIds - IDs of content panes (in display order)
   * @param layout - Calculated layout configuration
   * @param terminalHeight - Terminal height in cells
   */
  async applyPaneLayout(
    controlPaneId: string,
    contentPaneIds: string[],
    layout: LayoutConfiguration,
    terminalHeight: number,
    options?: { spacerPaneId?: string | null }
  ): Promise<void> {
    const numContentPanes = contentPaneIds.length;

    if (numContentPanes === 0) {
      // No content panes, just resize sidebar
      await this.resizeControlPane(controlPaneId);
      return;
    }

    try {
      // Always use custom layout string generation - unified approach for all cases
      // Use the calculated window dimensions, not current tmux dimensions (may be stale)
      const layoutString = generateSidebarGridLayout(
        controlPaneId,
        contentPaneIds,
        this.config.SIDEBAR_WIDTH,
        layout.windowWidth,
        terminalHeight,
        layout.cols,
        this.config.MAX_COMFORTABLE_WIDTH,
        {
          lastPaneIsSpacer:
            options?.spacerPaneId != null &&
            contentPaneIds[contentPaneIds.length - 1] === options.spacerPaneId,
        }
      );

      if (layoutString) {
        // Log pane state right before applying layout
        this.logPaneState();

        try {
          await this.tmuxService.selectLayout(layoutString);
        } catch {
          // LogService.getInstance().debug('Layout application failed, using fallback', 'Layout');
          // Fallback to main-vertical if custom layout fails
          await this.applyMainVerticalFallback();
        }
      } else {
        // Empty layout string - fallback to main-vertical
        // LogService.getInstance().debug('Empty layout string, using main-vertical fallback', 'Layout');
        await this.applyMainVerticalFallback();
      }
    } catch (error) {
      // Fallback: just resize sidebar
      await this.resizeControlPane(controlPaneId);
    }
  }

  /**
   * Resizes the control pane (sidebar) to configured width
   * Used as ultimate fallback when layout application fails
   */
  private async resizeControlPane(controlPaneId: string): Promise<void> {
    try {
      await this.tmuxService.resizePane(controlPaneId, {
        width: this.config.SIDEBAR_WIDTH
      });
    } catch (error) {
      LogService.getInstance().error(
        'Error resizing control pane',
        'Layout',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Applies main-vertical layout as fallback
   * Used when custom layout string generation or application fails
   */
  private async applyMainVerticalFallback(): Promise<void> {
    try {
      await this.tmuxService.setWindowOption('main-pane-width', String(this.config.SIDEBAR_WIDTH));
      await this.tmuxService.selectLayout('main-vertical');
      // LogService.getInstance().debug('Fell back to main-vertical layout', 'Layout');
    } catch (error) {
      LogService.getInstance().error(`Main-vertical fallback failed: ${error}`, 'Layout');
    }
  }

  /**
   * Logs current pane state for debugging
   * Useful for diagnosing layout application failures
   */
  private logPaneState(): void {
    // Commented out to reduce log noise
    // try {
    //   const paneList = this.tmuxService.listPanesSync('#{pane_id}=#{pane_index}');
    //   LogService.getInstance().debug(`Panes right before layout apply: ${paneList}`, 'Layout');
    // } catch {
    //   // Ignore errors
    // }
  }
}
