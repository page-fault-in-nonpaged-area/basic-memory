# Pending Changes

## 1. Fork Distribution: Publishing & Installing Our basic-memory Fork

### Problem
We maintain a fork at `page-fault-in-nonpaged-area/basic-memory`. Users need to install _our_ fork, not the upstream `basicmachines-co/basic-memory` from PyPI. We also may not have `uv` available in all environments.

### Research Findings

#### Option A: `uv` install directly from GitHub (Recommended)
`uv` natively supports installing from git repos — no PyPI publish required:

```bash
# Install as a tool (puts `basic-memory` and `bm` on PATH)
uv tool install git+https://github.com/page-fault-in-nonpaged-area/basic-memory

# Install a specific tag/branch/commit
uv tool install git+https://github.com/page-fault-in-nonpaged-area/basic-memory@v0.1.0
uv tool install git+https://github.com/page-fault-in-nonpaged-area/basic-memory@main

# Run without installing (ephemeral)
uvx --from git+https://github.com/page-fault-in-nonpaged-area/basic-memory basic-memory mcp

# pip-compatible install into a venv
uv pip install git+https://github.com/page-fault-in-nonpaged-area/basic-memory
```

This works today with no changes to the repo. The `pyproject.toml` already has `hatchling` as its build backend and defines `basic-memory` / `bm` entry points.

#### Option B: `pip` install from GitHub (fallback when uv unavailable)
Standard pip also supports git installs:

```bash
pip install git+https://github.com/page-fault-in-nonpaged-area/basic-memory.git
pip install git+https://github.com/page-fault-in-nonpaged-area/basic-memory.git@main
pip install git+https://github.com/page-fault-in-nonpaged-area/basic-memory.git@v0.1.0
```

#### Option C: GitHub Releases with pre-built wheels
For environments where building from source is slow or problematic:

1. Tag a release: `git tag v0.1.0 && git push origin v0.1.0`
2. Build the wheel: `uv build` (produces `dist/basic_memory-0.1.0-py3-none-any.whl`)
3. Upload the `.whl` as a GitHub Release asset
4. Install from the release URL:
   ```bash
   pip install https://github.com/page-fault-in-nonpaged-area/basic-memory/releases/download/v0.1.0/basic_memory-0.1.0-py3-none-any.whl
   ```

A GitHub Actions workflow can automate this on tag push.

#### Option D: Private PyPI (overkill for now)
Publish to a private PyPI index or use `uv` with `--index-url`. Unnecessary given Options A-C.

### Versioning Note
The project uses `uv-dynamic-versioning` (git tag → PEP 440 version). To get proper versions:
- Tag releases: `git tag v0.1.0`
- Without tags, version falls back to `0.0.0`

### Recommended Approach
1. **Primary**: `uv tool install git+https://github.com/page-fault-in-nonpaged-area/basic-memory` — works today, zero setup
2. **Tags**: Start tagging releases (`v0.1.0`, etc.) for reproducible installs
3. **GitHub Actions** (optional): Add a workflow to build and upload wheels on tag push
4. **MCP config** references our fork explicitly:
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
   (The `basic-memory` command is on PATH after `uv tool install`)

### Action Items — Fork Distribution
- [ ] Tag an initial release (`v0.1.0`) after implementing schema enforcement changes from `revised-plan.md`
- [ ] Document install-from-fork instructions in README or a SETUP.md
- [ ] (Optional) Add `.github/workflows/release.yml` to build + upload wheel on tag push
- [ ] (Optional) Consider renaming the package in `pyproject.toml` if we want to avoid name collision with upstream on PyPI (e.g. `agent-memory` or `bm-memory`)

---

## 2. VS Code Extension Rename: agent-memory → bm-controls / "Basic Memory Control Panel"

### Current State
The extension lives at `vscode/` in this repo:
- **package.json** name: `agent-memory`, displayName: `Agent Memory`
- **Publisher**: `page-fault-in-nonpaged-area`
- **VSIX**: `agent-memory-0.1.0.vsix`
- **Activity bar**: container id `agent-memory`, title `Agents`
- **Views**: `agentLoader` ("Agent Loader"), `agentList` ("Agents in this project")
- **Secrets keys**: `agent-memory.skillsRepo`, `agent-memory.agentsRepo`
- **Activation**: `workspaceContains:.github/agents`
- **Source files**: `extension.ts`, `agentLoader.ts`, `agentListView.ts`
- **Console logs**: "Agent Memory extension activated/deactivated"

### Rename Plan

#### package.json Changes
| Field | Old | New |
|-------|-----|-----|
| `name` | `agent-memory` | `bm-controls` |
| `displayName` | `Agent Memory` | `Basic Memory Control Panel` |
| `description` | `Dashboard for managing agent memory files and prompts` | `Control panel for Basic Memory — install, start, and manage agent memory` |

#### Activity Bar & Views
| Field | Old | New |
|-------|-----|-----|
| `viewsContainers.activitybar[0].id` | `agent-memory` | `bm-controls` |
| `viewsContainers.activitybar[0].title` | `Agents` | `Basic Memory` |
| `views` key | `agent-memory` | `bm-controls` |

#### New Section: "Basic Memory Controls"
Add a new view to the `bm-controls` view container:

```jsonc
{
  "views": {
    "bm-controls": [
      {
        "id": "bmSetup",
        "name": "Basic Memory Controls",
        "type": "webview"
      },
      {
        "id": "agentLoader",
        "name": "Agent Loader",
        "type": "webview"
      },
      {
        "id": "agentList",
        "name": "Agents in this project",
        "type": "webview"
      }
    ]
  }
}
```

The **"Basic Memory Controls"** view should provide:
- **Install Basic Memory** — button that runs `uv tool install git+https://github.com/page-fault-in-nonpaged-area/basic-memory` (or detects if already installed)
- **Start Basic Memory** — button that runs `basic-memory mcp` (or starts the MCP server with project enforcement)
- **Status indicator** — shows whether basic-memory is installed, version, and whether MCP server is running
- **Project selector** — list/switch active basic-memory projects

#### Commands to Register
```jsonc
{
  "commands": [
    {
      "command": "bm-controls.installBasicMemory",
      "title": "Install Basic Memory",
      "category": "Basic Memory"
    },
    {
      "command": "bm-controls.startBasicMemory",
      "title": "Start Basic Memory",
      "category": "Basic Memory"
    },
    {
      "command": "bm-controls.stopBasicMemory",
      "title": "Stop Basic Memory",
      "category": "Basic Memory"
    },
    {
      "command": "bm-controls.checkStatus",
      "title": "Check Status",
      "category": "Basic Memory"
    }
  ]
}
```

#### Source File Changes
| File | Change |
|------|--------|
| `extension.ts` | Update log messages from "Agent Memory" → "Basic Memory Control Panel". Register new `bmSetup` webview provider. |
| `agentLoader.ts` | Update secret keys from `agent-memory.*` → `bm-controls.*` |
| `agentListView.ts` | No structural changes needed (agent list functionality stays the same) |
| New: `bmSetupView.ts` | New webview provider for the "Basic Memory Controls" panel (install/start/status) |

#### VSIX Output
- Old: `agent-memory-0.1.0.vsix`
- New: `bm-controls-0.2.0.vsix` (bump version for the rename)
- Delete the old `agent-memory-0.1.0.vsix`

#### Migration Concerns
- **Secret keys**: Users who saved repo URLs under `agent-memory.*` keys will lose them. Add migration logic to read old keys and copy to new ones on activation.
- **Activity bar position**: Renaming the container ID will reset its position in the activity bar for existing users.

### Action Items — Extension Rename
- [x] Update `package.json`: name, displayName, description, viewsContainers, views
- [x] Add commands array to `package.json` (install, start, stop, status)
- [x] Add `bmSetup` view to views config
- [x] Create `src/bmSetupView.ts` — webview for install/start/status controls
- [x] Update `extension.ts` — new log messages, register bmSetup provider, register commands
- [x] Update `agentLoader.ts` — migrate secret key prefix from `agent-memory.*` → `bm-controls.*`
- [x] Update webview HTML/CSS if branding references "Agent Memory"
- [x] Bump version to `0.2.0` in `package.json`
- [x] Build new VSIX: `cd vscode && npm run package` → `bm-controls-0.2.0.vsix`
- [x] Delete old `agent-memory-0.1.0.vsix`
- [x] Add `.vscodeignore` for clean VSIX packaging
- [ ] Update any documentation referencing the old extension name

---

## Summary / Priority Order

1. ~~**Implement schema enforcement** (from `revised-plan.md`) — prerequisite for everything~~ **✅ DONE**
2. **Tag first release** (`v0.1.0`) — enables reproducible installs
3. ~~**Rename extension** to `bm-controls` / "Basic Memory Control Panel"~~ **✅ DONE**
4. ~~**Add "Basic Memory Controls" panel** (install/start/status)~~ **✅ DONE**
5. ~~**Build new VSIX** and delete old one~~ **✅ DONE**
6. **(Optional)** GitHub Actions release workflow for automated wheel builds

### Implemented (this session)

- **`server.py`**: `enforce_project_schemas()` — promotes `project` from optional → required in tool JSON schemas when `BASIC_MEMORY_REQUIRE_PROJECT=true`
- **`project_context.py`**: Structured error message with usage examples and available projects
- **`tests/mcp/test_project_enforcement.py`**: Full test coverage for enforcement logic
- **`revised-plan.md`**: Updated status, added memory categories and agent prompt template
