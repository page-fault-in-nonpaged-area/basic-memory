"""
Basic Memory FastMCP server.

Includes optional project enforcement for multi-agent isolation.
When BASIC_MEMORY_REQUIRE_PROJECT=true, every tool that accepts a 'project'
parameter (except exempt discovery tools) will advertise it as required
in the JSON schema. This prevents concurrent subagents from accidentally
writing to wrong projects.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastmcp import FastMCP
from loguru import logger

from basic_memory import db
from basic_memory.mcp.container import McpContainer, set_container
from basic_memory.services.initialization import initialize_app

# --- Project Enforcement ---
# Tools that intentionally work without a project parameter:
# - recent_activity: supports discovery mode (cross-project activity listing)
# - list_memory_projects: lists all projects (no project context needed)
# - create_memory_project: creates a new project (project doesn't exist yet)
# - delete_project: deletes a project by name (not project-scoped work)
EXEMPT_TOOLS = frozenset({
    "recent_activity",
    "list_memory_projects",
    "create_memory_project",
    "delete_project",
})


def enforce_project_schemas() -> int:
    """Make 'project' required in tool schemas for multi-agent isolation.

    Iterates through all registered tools in the tools module and promotes
    the 'project' parameter from optional to required in the JSON schema.
    This causes MCP clients (LLMs) to always include the project parameter,
    preventing cross-agent memory contamination when multiple subagents
    run concurrently.

    Returns:
        Number of tools that were patched.
    """
    # Deferred import — tools module is imported by the CLI command,
    # so it's available by the time the lifespan runs.
    import basic_memory.mcp.tools as tools_module

    patched = 0
    for attr_name in tools_module.__all__:
        tool_obj = getattr(tools_module, attr_name, None)
        if tool_obj is None:
            continue

        # Only process objects that look like FastMCP Tool instances
        if not hasattr(tool_obj, "parameters") or not isinstance(tool_obj.parameters, dict):
            continue

        # Skip tools that don't have a project parameter at all
        props = tool_obj.parameters.get("properties", {})
        if "project" not in props:
            continue

        # Skip exempt tools that intentionally work without project
        tool_name = getattr(tool_obj, "name", attr_name)
        if tool_name in EXEMPT_TOOLS:
            continue

        # Promote project from optional → required in the JSON schema
        required = tool_obj.parameters.setdefault("required", [])
        if "project" not in required:
            required.append("project")
            patched += 1
            logger.debug(f"Enforced required project on tool: {tool_name}")

    return patched


@asynccontextmanager
async def lifespan(app: FastMCP):
    """Lifecycle manager for the MCP server.

    Handles:
    - Project-scoped locking (ensures one server per project)
    - Database initialization and migrations
    - Project enforcement for multi-agent isolation (when enabled)
    - File sync via SyncCoordinator (if enabled and not in cloud mode)
    - Proper cleanup on shutdown
    """
    # --- Composition Root ---
    # Create container and read config (single point of config access)
    container = McpContainer.create()
    set_container(container)

    logger.debug(f"Starting Basic Memory MCP server (mode={container.mode.name})")

    # --- Cross-Project Isolation ---
    # Each VSCode window runs its own MCP server process (stdio transport).
    # Each workspace has its own .memory-mcp/ directory (via BASIC_MEMORY_CONFIG_DIR).
    # No lock needed - each window is naturally isolated by process and config directory.
    # Cross-project contamination is prevented by BASIC_MEMORY_REQUIRE_PROJECT enforcement.

    # --- Project Enforcement ---
    # Trigger: BASIC_MEMORY_REQUIRE_PROJECT env var is set to a truthy value
    # Why: When VS Code spawns multiple concurrent subagents, each must write
    #      to its own project. Schema enforcement makes the LLM always specify
    #      which project to use, preventing cross-agent memory contamination.
    # Outcome: 'project' becomes required in the JSON schema for all
    #          non-exempt tools, so LLMs cannot omit it.
    if os.environ.get("BASIC_MEMORY_REQUIRE_PROJECT", "").lower() in ("true", "1", "yes"):
        patched = enforce_project_schemas()
        logger.info(
            f"Project enforcement enabled: patched {patched} tool(s) "
            f"to require 'project' parameter"
        )

    # Track if we created the engine (vs test fixtures providing it)
    # This prevents disposing an engine provided by test fixtures when
    # multiple Client connections are made in the same test
    engine_was_none = db._engine is None

    # Initialize app (runs migrations, reconciles projects)
    await initialize_app(container.config)

    # Create and start sync coordinator (lifecycle centralized in coordinator)
    sync_coordinator = container.create_sync_coordinator()
    await sync_coordinator.start()

    try:
        yield
    finally:
        # Shutdown - coordinator handles clean task cancellation
        logger.debug("Shutting down Basic Memory MCP server")
        await sync_coordinator.stop()

        # Only shutdown DB if we created it (not if test fixture provided it)
        if engine_was_none:
            await db.shutdown_db()
            logger.debug("Database connections closed")
        else:  # pragma: no cover
            logger.debug("Skipping DB shutdown - engine provided externally")
        
        # Release lock
        lock.release()
        logger.debug("MCP server lock released")


mcp = FastMCP(
    name="Basic Memory",
    lifespan=lifespan,
)
