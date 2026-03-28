import { useState } from "react"
import type { DmuxSettings } from "../types.js"

/**
 * Hook to manage all dialog-related state in DmuxApp
 * Centralizes: command prompts, file copy dialog, running status, quit confirmation, inline settings
 */
export function useDialogState() {
  const [showCommandPrompt, setShowCommandPrompt] = useState<"test" | "dev" | null>(null)
  const [commandInput, setCommandInput] = useState("")
  const [showFileCopyPrompt, setShowFileCopyPrompt] = useState(false)
  const [currentCommandType, setCurrentCommandType] = useState<"test" | "dev" | null>(null)
  const [runningCommand, setRunningCommand] = useState(false)
  const [quitConfirmMode, setQuitConfirmMode] = useState(false)

  // Inline settings dialog state (fallback when tmux popups unavailable)
  const [showInlineSettings, setShowInlineSettings] = useState(false)
  const [inlineSettingsIndex, setInlineSettingsIndex] = useState(0)
  const [inlineSettingsMode, setInlineSettingsMode] = useState<'list' | 'edit' | 'scope'>('list')
  const [inlineSettingsEditingKey, setInlineSettingsEditingKey] = useState<keyof DmuxSettings | undefined>(undefined)
  const [inlineSettingsEditingValueIndex, setInlineSettingsEditingValueIndex] = useState(0)
  const [inlineSettingsScopeIndex, setInlineSettingsScopeIndex] = useState(0)
  const [inlineSettingsProjectRoot, setInlineSettingsProjectRoot] = useState<string | undefined>(undefined)

  /**
   * Check if any dialog is currently open
   * Used to determine if input should be blocked
   */
  const isAnyDialogOpen = () => {
    return !!(
      showCommandPrompt ||
      showFileCopyPrompt ||
      runningCommand ||
      quitConfirmMode ||
      showInlineSettings
    )
  }

  /**
   * Check if any modal dialog is open (excluding running indicator)
   * Used for input routing decisions
   */
  const isModalDialogOpen = () => {
    return !!(showCommandPrompt || showFileCopyPrompt || showInlineSettings)
  }

  /**
   * Close all dialogs
   * Useful for cleanup or reset scenarios
   */
  const closeAllDialogs = () => {
    setShowCommandPrompt(null)
    setCommandInput("")
    setShowFileCopyPrompt(false)
    setCurrentCommandType(null)
    setRunningCommand(false)
    setQuitConfirmMode(false)
    setShowInlineSettings(false)
    setInlineSettingsMode('list')
    setInlineSettingsIndex(0)
    setInlineSettingsEditingKey(undefined)
    setInlineSettingsEditingValueIndex(0)
    setInlineSettingsScopeIndex(0)
    setInlineSettingsProjectRoot(undefined)
  }

  const resetInlineSettings = () => {
    setShowInlineSettings(false)
    setInlineSettingsMode('list')
    setInlineSettingsIndex(0)
    setInlineSettingsEditingKey(undefined)
    setInlineSettingsEditingValueIndex(0)
    setInlineSettingsScopeIndex(0)
    setInlineSettingsProjectRoot(undefined)
  }

  return {
    // State
    showCommandPrompt,
    setShowCommandPrompt,
    commandInput,
    setCommandInput,
    showFileCopyPrompt,
    setShowFileCopyPrompt,
    currentCommandType,
    setCurrentCommandType,
    runningCommand,
    setRunningCommand,
    quitConfirmMode,
    setQuitConfirmMode,

    // Inline settings state
    showInlineSettings,
    setShowInlineSettings,
    inlineSettingsIndex,
    setInlineSettingsIndex,
    inlineSettingsMode,
    setInlineSettingsMode,
    inlineSettingsEditingKey,
    setInlineSettingsEditingKey,
    inlineSettingsEditingValueIndex,
    setInlineSettingsEditingValueIndex,
    inlineSettingsScopeIndex,
    setInlineSettingsScopeIndex,
    inlineSettingsProjectRoot,
    setInlineSettingsProjectRoot,
    resetInlineSettings,

    // Helper functions
    isAnyDialogOpen,
    isModalDialogOpen,
    closeAllDialogs,
  }
}
