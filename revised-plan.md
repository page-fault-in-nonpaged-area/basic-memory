# Revised Plan: Agent Memory with basic-memory

## Key Finding: Implementation Required

**basic-memory does NOT have project enforcement.** The `BASIC_MEMORY_REQUIRE_PROJECT` env var and schema mutation code described in DESIGN.md are features we need to implement — they don't exist upstream.

**Current state:**
- All 17 MCP tools have `project: Optional[str] = None` — optional in JSON schema
- Missing project triggers a generic error: `"No project specified. Either set 'default_project_mode=true'..."`
- No schema-level enforcement exists

---

## What We Implemented

### Change 1: Schema enforcement (server.py) — ✅ DONE

Added `enforce_project_schemas()` function and integrated it into the `lifespan()` function.
The function iterates through all registered tools in the `basic_memory.mcp.tools` module and
promotes the `project` parameter from optional to required in the JSON schema.

Key design decisions:
- Uses the module attribute approach (not FastMCP internals) for robustness across versions
- `FunctionTool` objects returned by `@mcp.tool` are the same objects stored in the provider,
  so mutating `parameters["required"]` takes effect immediately
- Idempotent — calling twice doesn't duplicate entries
- Returns the count of patched tools for logging

```python
# Exempt tools that intentionally work without project context
EXEMPT_TOOLS = frozenset({
    "recent_activity",        # discovery mode (cross-project listing)
    "list_memory_projects",   # lists all projects
    "create_memory_project",  # project doesn't exist yet
    "delete_project",         # not project-scoped work
})
```

### Change 2: Better error message (project_context.py) — ✅ DONE

Replaced the generic ValueError with a structured, actionable message that guides
agents to include `project=` in every call. Includes available project names.

### Change 3: Tests — ✅ DONE

Added `tests/mcp/test_project_enforcement.py` with:
- `TestEnforceProjectSchemas`: schema patching, exemptions, idempotency, skip logic
- `TestEnforcementInLifespan`: env var integration via monkeypatch

---

## How to Start basic-memory

```bash
# Without enforcement (current behavior)
basic-memory mcp

# With enforcement
BASIC_MEMORY_REQUIRE_PROJECT=true basic-memory mcp
```

**Claude Desktop / VS Code MCP config:**
```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "basic-memory",
      "args": ["mcp"],
      "env": {
        "BASIC_MEMORY_REQUIRE_PROJECT": "true"
      }
    }
  }
}
```

---

## Multi-Agent Isolation Model

When VS Code spawns multiple concurrent subagents (e.g., Plan, build, deploy), each subagent
gets its own project via the `project=` parameter. Schema enforcement ensures agents cannot
accidentally read/write to each other's memory.

```
VS Code
├── Subagent: Plan    → project="agent-plan"
├── Subagent: build   → project="agent-build"
└── Subagent: deploy  → project="agent-deploy"
```

Each project is a fully isolated namespace in basic-memory with its own:
- File directory tree
- Database records
- Knowledge graph
- Search index

---

## Memory Categories for Engineering Agents

Agents focused on engineering, reasoning, and analytics tasks. No persona layer —
agents are tools, not personalities.

### Observation Categories

Used in note content as `- [category] Observation text`:

| Category    | Purpose                                    | Example |
|-------------|--------------------------------------------|---------|
| `[fix]`     | Problem + solution pairs                   | `- [fix] Docker build hangs — add --no-cache flag` |
| `[pattern]` | Reusable approaches that work              | `- [pattern] Use tmpdir fixtures for file-system tests` |
| `[decision]`| Design choices with rationale              | `- [decision] SQLite over Postgres for local dev — simpler, no daemon` |
| `[finding]` | Analysis results, measurements             | `- [finding] API latency p99 = 340ms after connection pooling` |
| `[blocker]` | Issues requiring escalation                | `- [blocker] CI fails on arm64 — need cross-compile config` |
| `[config]`  | Environment/configuration details          | `- [config] BASIC_MEMORY_REQUIRE_PROJECT=true for multi-agent` |
| `[caveat]`  | Edge cases, gotchas, things to watch out   | `- [caveat] FastMCP 2.14.x breaks tool visibility — pinned to 2.12.3` |

### Directory Structure

Used as the `directory` parameter in `write_note()`:

| Directory       | Purpose                                  | Retention |
|-----------------|------------------------------------------|-----------|
| `experience/`   | Solutions, patterns, fixes               | Persistent — grows over time |
| `escalations/`  | Problems needing human input             | Active — resolved items archived |
| `context/`      | Session state, handoff notes             | Ephemeral — overwritten each session |
| `analysis/`     | Research findings, benchmarks, evals     | Persistent — referenced by other notes |

### Escalation Pattern (triggers VS Code alert)

The VS Code plugin watches for files containing "Human Input Required" and
shows a warning badge + alert in the agent sidebar.

```python
write_note(
    project="agent-build",
    title="CI Cross-Compile Failure",
    directory="escalations",
    content="""
## Problem
- [blocker] CI pipeline fails on arm64 architecture
- [finding] The Dockerfile uses x86-only base image

## Human Input Required

Need guidance on which arm64 base image to use for the build pipeline.
Options considered:
1. python:3.12-slim (multi-arch) — simplest
2. Custom base with pre-built wheels — faster builds

## Resolution

<!-- Human fills this in -->
"""
)
```

---

## Agent Prompt Requirements

Every `.github/agents/*.agent.md` file MUST include:

```markdown
## Memory Protocol

**CRITICAL**: Include `project="agent-{your-name}"` in EVERY MCP tool call.

### Session Start
1. Check escalations: `search_notes(project="agent-{name}", query="blocker")`
2. Load recent experience: `recent_activity(project="agent-{name}", timeframe="7d")`
3. Load working context: `build_context(project="agent-{name}", url="memory://context/*")`

### Correct Examples
✅ `write_note(project="agent-build", title="Fix", directory="experience", content="...")`
✅ `search_notes(project="agent-build", query="docker")`
✅ `read_note(project="agent-build", identifier="experience/docker-fix")`

### Incorrect Examples (NEVER DO THIS)
❌ `write_note(title="Fix", ...)` — Missing project parameter
❌ `search_notes(query="docker")` — Will fail or hit wrong project

### Directory Structure
- `experience/` — solutions, patterns, fixes (persistent knowledge)
- `escalations/` — problems requiring human help (triggers VS Code alert)
- `context/` — session state, handoff notes (overwritten each session)
- `analysis/` — research findings, benchmarks, evaluations

### Observation Categories
Use these in note content: `[fix]`, `[pattern]`, `[decision]`, `[finding]`,
`[blocker]`, `[config]`, `[caveat]`

### When Stuck — Escalate
Write an escalation note (the text "Human Input Required" triggers a VS Code alert):

write_note(
    project="agent-{name}",
    title="Problem Title",
    directory="escalations",
    content="## Problem\n- [blocker] Description\n\n## Human Input Required\n\n..."
)
```

---

## Summary

| Item | Status | Effort |
|------|--------|--------|
| Schema enforcement env var | **✅ Implemented** | `server.py` — `enforce_project_schemas()` |
| Better error messages | **✅ Implemented** | `project_context.py` — structured ValueError |
| Tests | **✅ Implemented** | `tests/mcp/test_project_enforcement.py` |
| Memory categories | **✅ Designed** | 7 observation categories, 4 directories |
| Agent prompt template | **✅ Designed** | Session start, escalation pattern |
| VS Code extension rename | **Pending** | See `pending-changes.md` |
| Project creation | **Works as-is** | `basic-memory project add agent-{name} path` |
