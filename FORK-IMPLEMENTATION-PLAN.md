# Fork Implementation Plan — Basic Memory with Agent Controls

## Executive Summary

This fork adds **per-agent memory controls** and **explicit human review flagging** to Basic Memory. The goal is minimal merge conflicts on future upstream syncs by:

1. **Isolating fork-specific logic** into dedicated modules
2. **Wrapping upstream functions** instead of modifying them in-place
3. **Using configuration files** (`.memory-mcp/agent-controls.json`) instead of code changes
4. **Minimizing tool signature changes** where possible
5. **Everything should be in .memory-mcp** the memory or the sqlite DB should not be in the home folder.

---

## Fork Features (37 files changed)

### 1. Project-Scoped MCP with Explicit `project` Parameter

**What**: All MCP tools require explicit `project` parameter (e.g., `"build"`, `"deploy"`, `"backend"`).

**Why**: Enables per-agent memory isolation and controls.

**Files modified**:
- All tool files in `src/basic_memory/mcp/tools/*.py` (12 files)
- `src/basic_memory/mcp/project_context.py` — Added `check_agent_controls()` and `OperationType` enum

**Merge conflict risk**: **HIGH** — Tool signatures may change upstream.

---

### 2. Agent Controls System

**What**: `.memory-mcp/agent-controls.json` controls which agents can access memory:
```json
{
  "agents": {
    "build": {"enabled": true, "paused": false},
    "deploy": {"enabled": true, "paused": false}
  }
}
```
- `enabled: false` → All operations blocked
- `paused: true` → Only read operations allowed, writes blocked

**Why**: Prevents agents from writing bad memories or spamming notes.

**Files**:
- `.memory-mcp/agent-controls.json` — Config file
- `src/basic_memory/mcp/project_context.py` — `read_agent_controls()`, `check_agent_controls()`
- All MCP tools call `check_agent_controls(project, OperationType.READ/WRITE)` before operations

**Merge conflict risk**: **MEDIUM** — `project_context.py` is heavily modified upstream.

---

### 3. Human Review Banner (`requires_human_review`)

**What**: `write_note()` accepts `requires_human_review: bool | None` parameter. When `True`, automatically appends:
```
=============================
>>> Human Input Required <<<
=============================
```

**Why**: Agents can flag notes that need human review (e.g., unresolved questions, blocked implementations).

**Files**:
- `src/basic_memory/mcp/tools/write_note.py` — Added `requires_human_review`, `_apply_human_review_banner()`
- `tests/mcp/test_tool_write_note.py` — Tests for banner logic

**Merge conflict risk**: **MEDIUM** — `write_note.py` frequently changes upstream.

---

### 4. VSCode Extension (`vscode/`)

**What**: VSCode extension providing:
- UI to install/start/stop Basic Memory MCP server
- Agent discovery (finds `.github/agents/*.agent.md`, reads `project` from agent files)
- Agent control panel (enable/disable/pause agents, updates `agent-controls.json`)
- Open agent notes in VSCode

**Why**: Makes fork features usable without CLI commands.

**Files**:
- `vscode/` directory (new, entire TypeScript extension)
- `vscode/bm-controls-0.2.0.vsix` — Packaged extension

**Merge conflict risk**: **NONE** — Isolated, no upstream equivalent.

---

### 5. Agent Files (`.github/agents/`)

**What**: Example agent files for build and deploy agents.

**Files**:
- `.github/agents/build.agent.md`
- `.github/agents/deploy.agent.md`
- `.github/agents/backend.agent.md` (created in this session)

**Merge conflict risk**: **NONE** — Isolated, no upstream equivalent.

---

### 6. Skills (`.github/skills/`)

**What**: Extracted reusable skills for backend agent.

**Files**:
- `.github/skills/testing/SKILL.md`
- `.github/skills/architecture/SKILL.md`
- `.github/skills/tdd-workflow/SKILL.md`
- `.github/skills/state-codes/SKILL.md`
- `.github/skills/memory-workflow/SKILL.md`

**Merge conflict risk**: **NONE** — Isolated, no upstream equivalent.

---

## Merge Conflict Hotspots

Based on the backup diff, these files **will conflict** on every upstream sync:

| File | Fork Changes | Conflict Risk | Strategy |
|---|---|---|---|
| `src/basic_memory/mcp/project_context.py` | +101 lines (agent controls) | **HIGH** | Use wrapper functions, minimize inline edits |
| `src/basic_memory/mcp/tools/*.py` (12 files) | +`check_agent_controls()` calls | **HIGH** | Create decorator to inject controls |
| `src/basic_memory/mcp/tools/write_note.py` | +`requires_human_review` param | **MEDIUM** | Make param truly optional w/ default None |
| `src/basic_memory/config.py` | +`BASIC_MEMORY_CONFIG_DIR` env var | **LOW** | Upstream rarely changes config |

---

## Implementation Strategy (Minimize Conflicts)

### Goal: Make fork changes **additive** rather than **invasive**.

### Phase 1: Isolate Agent Controls into Decorator

**Current approach** (invasive):
```python
# In every tool file
from basic_memory.mcp.project_context import check_agent_controls, OperationType

async def write_note(...):
    project = get_active_project(...)
    check_agent_controls(project, OperationType.WRITE)  # <-- injected everywhere
    ...
```

**New approach** (isolated):
```python
# src/basic_memory/mcp/agent_controls.py (NEW FILE)
from functools import wraps

def enforce_agent_controls(operation: OperationType):
    """Decorator that enforces agent controls before tool execution."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, project: str | None = None, **kwargs):
            resolved_project = get_active_project(project, ...)
            check_agent_controls(resolved_project, operation)
            return await func(*args, project=project, **kwargs)
        return wrapper
    return decorator

# In tool files
@mcp.tool(...)
@enforce_agent_controls(OperationType.WRITE)  # <-- single line addition
async def write_note(...):
    # No check_agent_controls() call needed
    ...
```

**Benefits**:
- Only 1 line added per tool (decorator)
- All control logic in isolated `agent_controls.py`
- Easier to resolve conflicts: just re-add decorator line after upstream merge

---

### Phase 2: Make `requires_human_review` Truly Optional

**Current approach**:
```python
async def write_note(
    ...
    requires_human_review: bool | None = None,  # Added to signature
):
    content = _apply_human_review_banner(content, requires_human_review)
```

**Issue**: Upstream may change `write_note` signature, causing conflicts.

**New approach** (backward compatible):
```python
# Keep requires_human_review optional with default None
# If None, infer from content (check if banner already exists)
# This makes the param truly optional — tools don't break if it's missing

def _apply_human_review_banner(content: str, requires_human_review: bool | None = None) -> str:
    """Apply or remove banner. If requires_human_review is None, infer from content."""
    has_banner = ">>> Human Input Required <<<" in content
    
    if requires_human_review is None:
        # Infer: if banner exists, keep it; otherwise, no banner
        return content
    
    # Explicit decision: add or remove banner
    content_without_banner = remove_banner(content)
    if requires_human_review:
        return f"{content_without_banner}\n\n{HUMAN_INPUT_BANNER}"
    return content_without_banner
```

**Benefits**:
- If upstream changes `write_note` signature, our param can be re-added as optional
- Doesn't break if param is missing — banner still works if agent includes it manually

---

### Phase 3: Wrapper Functions for Project Resolution

**Current approach**: Modified `get_active_project()` in `project_context.py` in-place.

**Issue**: `project_context.py` is frequently changed upstream.

**New approach** (wrapper):
```python
# src/basic_memory/mcp/project_context.py
# Keep upstream get_active_project() as-is

# NEW FUNCTION (add at bottom)
def get_active_project_with_controls(
    project: str | None,
    context: Context | None,
    operation: OperationType,
) -> str:
    """Wrapper that adds agent controls to get_active_project()."""
    resolved_project = get_active_project(project, context)  # Upstream function
    check_agent_controls(resolved_project, operation)  # Fork addition
    return resolved_project
```

**Benefits**:
- Upstream `get_active_project()` stays unchanged
- Fork logic is additive (new function)
- If upstream changes `get_active_project()`, we automatically inherit the changes

---

### Phase 4: Configuration-Driven Features

**Principle**: Use config files instead of code changes where possible.

**Examples**:
1. **Agent controls**: `.memory-mcp/agent-controls.json` (already done)
2. **Agent discovery**: `.github/agents/*.agent.md` (already done)
3. **Feature flags**: Could add `.memory-mcp/feature-flags.json` for experimental features

**Benefits**:
- No code conflicts
- Users can customize without rebuilding
- Fork can toggle features without code changes

---

## Recommended File Structure (Post-Refactor)

```
src/basic_memory/mcp/
├── project_context.py          # Minimize changes, keep upstream logic
├── agent_controls.py           # NEW — All agent control logic (decorator, checks)
├── formatting.py               # NEW — Human review banner logic (move from write_note.py)
├── tools/
│   ├── write_note.py           # Minimal changes: +requires_human_review param (optional)
│   ├── read_note.py            # Minimal changes: +@enforce_agent_controls decorator
│   └── ...                     # Minimal changes: +decorator on all tools
└── server.py                   # Upstream file, keep as-is

.memory-mcp/
├── agent-controls.json         # Config file (no merge conflicts)
└── feature-flags.json          # FUTURE: Optional feature toggles

.github/
├── agents/                     # Fork-specific, no conflicts
│   ├── backend.agent.md
│   ├── build.agent.md
│   └── deploy.agent.md
└── skills/                     # Fork-specific, no conflicts
    ├── testing/
    ├── architecture/
    └── ...

vscode/                         # Fork-specific, no conflicts
├── src/
├── package.json
└── bm-controls-0.2.0.vsix
```

---

## Merge Workflow (Future Upstream Syncs)

### Step 1: Fetch Upstream
```bash
git fetch upstream
git checkout main
git merge upstream/main  # Will have conflicts
```

### Step 2: Resolve Conflicts (Priority Order)

1. **Accept upstream for files with low fork changes**:
   ```bash
   git checkout --theirs src/basic_memory/config.py
   ```

2. **Manually merge high-conflict files**:
   - `src/basic_memory/mcp/project_context.py` — Re-add `check_agent_controls()` function at bottom
   - `src/basic_memory/mcp/tools/write_note.py` — Re-add `requires_human_review` param
   - All tool files — Re-add `@enforce_agent_controls` decorator (single line per file)

3. **Run tests**:
   ```bash
   just test  # Ensure fork features still work
   ```

### Step 3: Update Fork-Specific Tests

If upstream changes break fork tests, update:
- `tests/mcp/test_project_enforcement.py` — Agent controls tests
- `tests/mcp/test_tool_write_note.py` — Human review banner tests

---

## Development Rules (Minimize Future Conflicts)

1. **Never modify upstream files in-place** — Always use wrappers, decorators, or config files
2. **Make parameters optional** — New params should default to `None` and not break if omitted
3. **Isolate fork logic** — Put fork code in new files (`agent_controls.py`, `formatting.py`)
4. **Use decorators** — Single-line additions are easier to re-add after merge conflicts
5. **Document fork changes** — Keep this file updated with every fork feature added

---

## Testing Strategy

### Unit Tests (Fork Features)

- `tests/mcp/test_project_enforcement.py` — Agent controls (enabled/paused/disabled states)
- `tests/test_mcp_lock.py` — MCP lock file functionality
- `tests/mcp/test_tool_write_note.py` — Human review banner logic

### Integration Tests

- Test agent tools against live Basic Memory MCP server
- VSCode extension E2E tests (agent discovery, control panel)

### Regression Tests (After Upstream Merge)

- Run full test suite: `just test`
- Manually test:
  - Agent enable/disable/pause via VSCode extension
  - `requires_human_review=True` appends banner
  - Agent tools can read/write with controls

---

## Rollout Plan

### Phase 1: Refactor (Current Priority)

1. Create `src/basic_memory/mcp/agent_controls.py` with decorator
2. Create `src/basic_memory/mcp/formatting.py` for banner logic
3. Update all tool files to use decorator (replace inline `check_agent_controls()` calls)
4. Test refactored code

### Phase 2: Documentation

1. Update `AGENTS.md` with fork workflow
2. Create `docs/FORK-FEATURES.md` documenting agent controls and human review
3. Update VSCode extension README

### Phase 3: Next Upstream Sync (Test Strategy)

1. Create `test-merge` branch
2. Attempt upstream merge
3. Count conflicts, measure resolution time
4. If >20 conflicts or >2 hours, refactor further
5. Once manageable, merge to main

---

## Success Criteria

A successful fork implementation has:

- ✅ **<10 merge conflicts** per upstream sync
- ✅ **<30 minutes** to resolve conflicts
- ✅ **All fork features** still work after merge
- ✅ **All upstream features** inherited automatically
- ✅ **No CI/CD breakage** after merge

---

## Contact & Maintenance

- **Fork maintainer**: page-fault-in-nonpaged-area
- **Upstream**: basicmachines-co/basic-memory
- **Last upstream sync**: 2026-02-15 (sync'd with commit `113d1b6`)
- **Next review**: After 50 upstream commits or 1 month, whichever comes first
