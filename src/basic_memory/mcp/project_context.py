"""Project context utilities for Basic Memory MCP server.

Provides project lookup utilities for MCP tools.
Handles project validation and context management in one place.

Note: This module uses ProjectResolver for unified project resolution.
The resolve_project_parameter function is a thin wrapper for backwards
compatibility with existing MCP tools.
"""

import json
import os
from enum import Enum
from typing import Optional, List
from httpx import AsyncClient
from httpx._types import (
    HeaderTypes,
)
from loguru import logger
from fastmcp import Context

from basic_memory.config import ConfigManager
from basic_memory.project_resolver import ProjectResolver
from basic_memory.schemas.project_info import ProjectItem, ProjectList
from basic_memory.schemas.v2 import ProjectResolveResponse


class OperationType(Enum):
    """Type of memory operation for agent control checks."""
    READ = "read"   # search, read_note, build_context, list_directory
    WRITE = "write"  # write_note, edit_note, delete_note, move_note


def read_agent_controls() -> dict:
    """Read agent controls from .agent-memory/agent-controls.json.
    
    This config file controls agent memory access:
    - enabled: false = all memory operations blocked
    - paused: true = only read operations allowed, writes blocked
    
    Returns:
        Dict with 'agents' key containing per-agent controls.
        Returns empty dict if file doesn't exist or is invalid.
    """
    config_dir = os.environ.get("BASIC_MEMORY_CONFIG_DIR", "")
    if not config_dir:
        return {}
    
    controls_path = os.path.join(config_dir, "agent-controls.json")
    try:
        if os.path.exists(controls_path):
            with open(controls_path, "r") as f:
                return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Failed to read agent-controls.json: {e}")
    return {}


def check_agent_controls(
    project_name: str,
    operation: OperationType,
) -> None:
    """Check if an agent's memory operation is allowed.
    
    Reads from .agent-memory/agent-controls.json to check:
    - If agent is disabled: all operations blocked
    - If agent is paused: only write operations blocked
    
    Args:
        project_name: The project/agent name to check
        operation: The type of operation (READ or WRITE)
    
    Raises:
        PermissionError: If the operation is not allowed
    """
    controls = read_agent_controls()
    agents = controls.get("agents", {})
    
    # Extract agent name from project name (e.g., "agent-build" -> "build")
    agent_name = project_name
    if project_name.startswith("agent-"):
        agent_name = project_name[6:]
    
    agent_controls = agents.get(agent_name, {"enabled": True, "paused": False})
    enabled = agent_controls.get("enabled", True)
    paused = agent_controls.get("paused", False)
    
    if not enabled:
        raise PermissionError(
            f"# Memory Disabled\n\n"
            f"Agent '{agent_name}' memory is **disabled**.\n\n"
            f"All memory operations are blocked. To re-enable:\n"
            f"1. Open the VSCode extension sidebar\n"
            f"2. Find agent '{agent_name}' in the Agents Memories section\n"
            f"3. Click the 'Enable' button"
        )
    
    if paused and operation == OperationType.WRITE:
        raise PermissionError(
            f"# Memory Paused\n\n"
            f"Agent '{agent_name}' memory is **paused** (read-only mode).\n\n"
            f"You can still search and read memories, but writing is blocked.\n\n"
            f"To resume writing:\n"
            f"1. Open the VSCode extension sidebar\n"
            f"2. Find agent '{agent_name}' in the Agents Memories section\n"
            f"3. Click the 'Resume' button"
        )


async def resolve_project_parameter(
    project: Optional[str] = None,
    allow_discovery: bool = False,
    cloud_mode: Optional[bool] = None,
    default_project_mode: Optional[bool] = None,
    default_project: Optional[str] = None,
) -> Optional[str]:
    """Resolve project parameter using three-tier hierarchy.

    This is a thin wrapper around ProjectResolver for backwards compatibility.
    New code should consider using ProjectResolver directly for more detailed
    resolution information.

    if cloud_mode:
        project is required (unless allow_discovery=True for tools that support discovery mode)
    else:
        Resolution order:
        1. Single Project Mode  (--project cli arg, or BASIC_MEMORY_MCP_PROJECT env var) - highest priority
        2. Explicit project parameter - medium priority
        3. Default project if default_project_mode=true - lowest priority

    Args:
        project: Optional explicit project parameter
        allow_discovery: If True, allows returning None in cloud mode for discovery mode
            (used by tools like recent_activity that can operate across all projects)
        cloud_mode: Optional explicit cloud mode. If not provided, reads from ConfigManager.
        default_project_mode: Optional explicit default project mode. If not provided, reads from ConfigManager.
        default_project: Optional explicit default project. If not provided, reads from ConfigManager.

    Returns:
        Resolved project name or None if no resolution possible
    """
    # Load config for any values not explicitly provided
    if cloud_mode is None or default_project_mode is None or default_project is None:
        config = ConfigManager().config
        if cloud_mode is None:
            cloud_mode = config.cloud_mode
        if default_project_mode is None:
            default_project_mode = config.default_project_mode
        if default_project is None:
            default_project = config.default_project

    # Create resolver with configuration and resolve
    resolver = ProjectResolver.from_env(
        cloud_mode=cloud_mode,
        default_project_mode=default_project_mode,
        default_project=default_project,
    )
    result = resolver.resolve(project=project, allow_discovery=allow_discovery)
    return result.project


async def get_project_names(client: AsyncClient, headers: HeaderTypes | None = None) -> List[str]:
    # Deferred import to avoid circular dependency with tools
    from basic_memory.mcp.tools.utils import call_get

    response = await call_get(client, "/v2/projects/", headers=headers)
    project_list = ProjectList.model_validate(response.json())
    return [project.name for project in project_list.projects]


async def get_active_project(
    client: AsyncClient,
    project: Optional[str] = None,
    context: Optional[Context] = None,
    headers: HeaderTypes | None = None,
) -> ProjectItem:
    """Get and validate project, setting it in context if available.

    Args:
        client: HTTP client for API calls
        project: Optional project name (resolved using hierarchy)
        context: Optional FastMCP context to cache the result

    Returns:
        The validated project item

    Raises:
        ValueError: If no project can be resolved
        HTTPError: If project doesn't exist or is inaccessible
    """
    # Deferred import to avoid circular dependency with tools
    from basic_memory.mcp.tools.utils import call_post

    resolved_project = await resolve_project_parameter(project)
    if not resolved_project:
        project_names = await get_project_names(client, headers)
        raise ValueError(
            'Missing required parameter "project".\n'
            "\n"
            "Every tool call must include a project parameter to identify\n"
            "which agent's memory to operate on. This prevents concurrent\n"
            "subagents from contaminating each other's memory.\n"
            "\n"
            "Usage:\n"
            '  write_note(project="agent-build", title="...", ...)\n'
            '  search_notes(project="agent-build", query="...")\n'
            "\n"
            f"Available projects: {', '.join(project_names)}\n"
            "\n"
            'Tip: Always use project="agent-{your-name}" in every tool call.'
        )

    project = resolved_project

    # Check if already cached in context
    if context:
        cached_project = context.get_state("active_project")
        if cached_project and cached_project.name == project:
            logger.debug(f"Using cached project from context: {project}")
            return cached_project

    # Validate project exists by calling API
    logger.debug(f"Validating project: {project}")
    response = await call_post(
        client,
        "/v2/projects/resolve",
        json={"identifier": project},
        headers=headers,
    )
    resolved = ProjectResolveResponse.model_validate(response.json())
    active_project = ProjectItem(
        id=resolved.project_id,
        external_id=resolved.external_id,
        name=resolved.name,
        path=resolved.path,
        is_default=resolved.is_default,
    )

    # Cache in context if available
    if context:
        context.set_state("active_project", active_project)
        logger.debug(f"Cached project in context: {project}")

    logger.debug(f"Validated project: {active_project.name}")
    return active_project


def add_project_metadata(result: str, project_name: str) -> str:
    """Add project context as metadata footer for assistant session tracking.

    Provides clear project context to help the assistant remember which
    project is being used throughout the conversation session.

    Args:
        result: The tool result string
        project_name: The project name that was used

    Returns:
        Result with project session tracking metadata
    """
    return f"{result}\n\n[Session: Using project '{project_name}']"
