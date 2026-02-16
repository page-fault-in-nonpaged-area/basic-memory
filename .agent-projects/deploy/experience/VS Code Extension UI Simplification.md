---
title: VS Code Extension UI Simplification
type: note
permalink: experience/vs-code-extension-ui-simplification
tags:
- vscode-extension
- ui-simplification
- refactoring
---

## Changes Made

Modified the Basic Memory VS Code extension to simplify the control panel UI.

### Memory Controls Section
- **Removed**: Start and Stop buttons
- **Kept**: Install and Diagnose buttons
- **Updated button labels**:
  - Install button: Now shows `<download icon> Install` with visible text
  - DB button: Renamed to `<stethoscope icon> Diagnose` with visible text
- **CSS change**: Removed `.btn-row .btn span { display: none; }` rule to show button text

### Agent Loader Section
- **Completely removed** from the extension
- Deleted view registration from `package.json`
- Removed initialization code from `extension.ts`
- Removed import statement for `AgentLoaderViewProvider`

### Files Modified
1. `vscode/src/bmSetupView.ts` - Updated HTML and removed unused JavaScript functions
2. `vscode/package.json` - Removed agentLoader view configuration
3. `vscode/src/extension.ts` - Removed AgentLoaderViewProvider registration and import

### Result
Cleaner, more focused control panel with just two essential buttons and no agent loader complexity.


## Additional Fixes (Build 2)

### File Opening with Special Characters
- **Problem**: Files with special characters (apostrophes, quotes) in paths couldn't be opened - onclick handlers would break
- **Solution**: Added `escapeJs()` function to properly escape JavaScript string literals in HTML
- **Escapes**: Single quotes (`'`), double quotes (`"`), backslashes (`\`), newlines (`\n`), carriage returns (`\r`)
- **Applied to**: All file paths in onclick attributes (openFile, deleteMemory calls)
- **Examples handled**: 
  - `The Clockmaker's Archive.md` 
  - Files with quotes in names
  - Paths with backslashes

### URI Handling
- Changed `openTextDocument(msg.path)` to use `vscode.Uri.file(msg.path)`
- Added try-catch with error messages for debugging
- Proper handling of absolute paths with special characters

This ensures all memory items, edit buttons, and delete buttons work correctly regardless of special characters in file names or paths.