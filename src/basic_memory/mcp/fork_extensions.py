"""Fork-specific extensions for Basic Memory MCP.

This module contains fork-specific functionality that extends the upstream
Basic Memory project with minimal code changes. By isolating fork logic here,
we minimize merge conflicts during upstream syncs.

Features:
1. Agent controls - Enable/disable/pause agents via .memory-mcp/agent-controls.json
2. Human review banner - Flag notes that need human attention
3. Project enforcement - Ensure MCP calls specify project parameter
"""

import json
import re
from enum import Enum
from functools import wraps
from pathlib import Path
from typing import Callable, Any

from fastmcp import Context
from loguru import logger

from basic_memory.mcp.project_context import get_active_project


# ============================================================================
# Agent Controls System
# ============================================================================


class OperationType(str, Enum):
    """Types of operations subject to agent controls."""

    READ = "read"
    WRITE = "write"


def read_agent_controls(project_path: Path) -> dict[str, Any]:
    """Read agent controls from project's .memory-mcp/agent-controls.json.

    Args:
        project_path: Path to the project root directory

    Returns:
        Dictionary with agent control settings, or empty dict if file not found

    Example config:
        {
          "agents": {
            "build": {"enabled": true, "paused": false},
            "deploy": {"enabled": false, "paused": false}
          }
        }
    """
    controls_file = project_path / ".memory-mcp" / "agent-controls.json"
    if not controls_file.exists():
        logger.trace(f"No agent-controls.json found at {controls_file}")
        return {}

    try:
        with open(controls_file) as f:
            controls = json.load(f)
            logger.trace(f"Loaded agent controls: {controls}")
            return controls
    except Exception as e:
        logger.warning(f"Failed to read agent controls from {controls_file}: {e}")
        return {}


def check_agent_controls(
    project_name: str, project_path: Path, operation: OperationType
) -> None:
    """Check if agent is allowed to perform operation based on controls.

    Args:
        project_name: Name of the project/agent (e.g. "build", "deploy")
        project_path: Path to the project root directory
        operation: Type of operation (READ or WRITE)

    Raises:
        PermissionError: If agent is disabled or paused for write operations
    """
    controls = read_agent_controls(project_path)
    if not controls or "agents" not in controls:
        # No controls configured - allow all operations
        return

    agents = controls.get("agents", {})
    agent_config = agents.get(project_name, {})

    # Check if agent is disabled entirely
    if not agent_config.get("enabled", True):
        raise PermissionError(
            f"Agent '{project_name}' is disabled. Enable it in .memory-mcp/agent-controls.json"
        )

    # Check if agent is paused (read-only mode)
    if agent_config.get("paused", False) and operation == OperationType.WRITE:
        raise PermissionError(
            f"Agent '{project_name}' is paused (read-only). Unpause it in .memory-mcp/agent-controls.json"
        )

    logger.trace(
        f"Agent '{project_name}' allowed to perform {operation} (enabled={agent_config.get('enabled', True)}, paused={agent_config.get('paused', False)})"
    )


def enforce_project_and_controls(operation: OperationType) -> Callable:
    """Decorator that enforces project parameter and agent controls.

    This decorator:
    1. Validates that 'project' parameter is provided when called via MCP (context exists)
    2. Resolves the active project
    3. Checks agent controls (enabled/paused state)
    4. Passes resolved project info to the wrapped function

    Args:
        operation: Type of operation (READ or WRITE) for agent control checks

    Returns:
        Decorator function

    Usage:
        @mcp.tool()
        @enforce_project_and_controls(OperationType.WRITE)
        async def write_note(title: str, content: str, project: str | None = None, ...):
            # project is enforced when called via MCP
            ...
    """

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(
            *args, project: str | None = None, context: Context | None = None, **kwargs
        ):
            # When called via MCP (context exists), project must be specified
            if context is not None and project is None:
                return (
                    "# Error\n\n"
                    "Parameter 'project' is required when calling MCP tools. "
                    "Specify the project name (e.g., project='backend', project='build'). "
                    "If you don't know which projects exist, use list_memory_projects() first."
                )

            # For direct Python calls (context is None), use default project resolution
            # This is imported inside the wrapper to avoid circular imports
            from basic_memory.mcp.async_client import get_client

            async with get_client() as client:
                # Resolve active project (supports optional project parameter)
                active_project = await get_active_project(client, project, context)

                # Check agent controls (pause/disable)
                try:
                    check_agent_controls(
                        active_project.name, active_project.home, operation
                    )
                except PermissionError as e:
                    return str(e)

                # Call original function with resolved project name
                return await func(
                    *args, project=active_project.name, context=context, **kwargs
                )

        return wrapper

    return decorator


# ============================================================================
# Human Review Banner System
# ============================================================================


HUMAN_INPUT_BANNER = """=============================
>>> Human Input Required <<<
============================="""


def apply_human_review_banner(content: str, requires_human_review: bool) -> str:
    """Apply or remove the human-input banner based on explicit review decision.

    Args:
        content: Markdown content to potentially modify
        requires_human_review: Whether human review is required

    Returns:
        Content with banner added (if True) or removed (if False)
    """
    # Pattern matches the exact banner format with any surrounding newlines
    banner_pattern = re.compile(
        r"\n*={29}\n>>> Human Input Required <<<\n={29}\n*", re.MULTILINE
    )
    content_without_banner = re.sub(banner_pattern, "\n", content).rstrip()

    if not requires_human_review:
        return content_without_banner

    if content_without_banner:
        return f"{content_without_banner}\n\n{HUMAN_INPUT_BANNER}"
    return HUMAN_INPUT_BANNER
