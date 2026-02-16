"""Immediate memory tools for Basic Memory MCP server.

Immediate memory is a context-limited scratchpad (~5k tokens) designed to
survive LLM context compaction. It stores behavioral notes, status tracking,
and "what was I doing" state that agents can read at the start of each
context window to restore working state.

Unlike regular notes, immediate memory:
- Is a single file per project (_immediate.md)
- Has a strict token budget (5k tokens ≈ 20k characters)
- Is not processed through the knowledge graph
- Is meant to be overwritten frequently, not appended indefinitely
"""

from pathlib import Path
from typing import Optional

from loguru import logger
from fastmcp import Context

from basic_memory.mcp.fork_extensions import (
    OperationType,
    check_agent_controls,
)
from basic_memory.mcp.project_context import get_project_client
from basic_memory.mcp.server import mcp

# --- Token Budget ---
# 5,000 tokens ≈ 20,000 characters (4 chars/token average)
MAX_IMMEDIATE_CHARS = 20_000
IMMEDIATE_FILENAME = "_immediate.md"

EMPTY_TEMPLATE = """\
---
title: Immediate Memory
type: immediate
permalink: _immediate
tags: [immediate-memory]
---

# Immediate Memory

> Context-limited scratchpad that survives context compaction.
> Keep under 5k tokens. Overwrite freely.

"""


def _immediate_path(project_home: Path) -> Path:
    """Resolve path to the immediate memory file for a project."""
    return project_home / IMMEDIATE_FILENAME


@mcp.tool(
    description=(
        "Read the immediate memory scratchpad for a project. "
        "Returns the current contents of _immediate.md — a context-limited "
        "note designed to survive context compaction. Use this at the start "
        "of a conversation to restore working state."
    ),
)
async def read_immediate_memory(
    project: Optional[str] = None,
    context: Context | None = None,
) -> str:
    """Read the immediate memory file for a project.

    Immediate memory is a small (~5k token) scratchpad that persists across
    context windows. Read it early in each conversation to restore:
    - What you were doing
    - Behavioral notes and preferences
    - Counters, finger-counting, or other ephemeral state

    Args:
        project: Project name. Required when called through MCP.
                 Use list_memory_projects() to discover available projects.
        context: Optional FastMCP context.

    Returns:
        Contents of _immediate.md, or the empty template if none exists.
    """
    # Trigger: MCP call without project param
    # Why: immediate memory is per-project; must know which project
    # Outcome: clear error with guidance
    if context is not None and project is None:
        return (
            "# Error\n\n"
            "Parameter 'project' is required when calling MCP tools. "
            "Specify the project name (e.g., project='backend'). "
            "If you don't know which projects exist, use list_memory_projects() first."
        )

    async with get_project_client(project, context) as (_client, active_project):
        logger.info(
            f"MCP tool call tool=read_immediate_memory project={active_project.name}"
        )

        # Check agent controls (pause blocks writes, but reads are always ok)
        try:
            check_agent_controls(
                active_project.name, active_project.home, OperationType.READ
            )
        except PermissionError as e:
            return str(e)

        filepath = _immediate_path(active_project.home)
        if not filepath.exists():
            logger.debug(f"No immediate memory found at {filepath}, returning template")
            return EMPTY_TEMPLATE

        content = filepath.read_text(encoding="utf-8")
        logger.info(
            f"MCP tool response: tool=read_immediate_memory project={active_project.name} "
            f"chars={len(content)}"
        )
        return content


@mcp.tool(
    description=(
        "Write to the immediate memory scratchpad for a project. "
        "Overwrites _immediate.md with the provided content. "
        "Limited to ~5k tokens (20,000 characters). Use this to save "
        "'what was I doing' state that survives context compaction."
    ),
)
async def write_immediate_memory(
    content: str,
    project: Optional[str] = None,
    context: Context | None = None,
) -> str:
    """Write to the immediate memory file for a project.

    Overwrites the entire _immediate.md with new content. This is a
    scratchpad — write the full state you want to persist, not incremental
    appends.

    Good things to store:
    - Current task and progress ("Implementing feature X, step 3 of 5")
    - Behavioral preferences ("User prefers concise responses")
    - Counters or tracking state
    - Key decisions made this session
    - Emotional/tone notes ("User seems frustrated, be extra careful")

    Args:
        content: Full markdown content to write. Must be under 20,000 characters
                 (~5k tokens). Include frontmatter if desired.
        project: Project name. Required when called through MCP.
                 Use list_memory_projects() to discover available projects.
        context: Optional FastMCP context.

    Returns:
        Confirmation with character count and token estimate.
    """
    # Trigger: MCP call without project param
    # Why: immediate memory is per-project
    # Outcome: clear error with guidance
    if context is not None and project is None:
        return (
            "# Error\n\n"
            "Parameter 'project' is required when calling MCP tools. "
            "Specify the project name (e.g., project='backend'). "
            "If you don't know which projects exist, use list_memory_projects() first."
        )

    async with get_project_client(project, context) as (_client, active_project):
        logger.info(
            f"MCP tool call tool=write_immediate_memory project={active_project.name} "
            f"chars={len(content)}"
        )

        # Check agent controls (pause blocks writes)
        try:
            check_agent_controls(
                active_project.name, active_project.home, OperationType.WRITE
            )
        except PermissionError as e:
            return str(e)

        # Trigger: content exceeds token budget
        # Why: immediate memory must stay small to be useful after compaction
        # Outcome: reject with clear budget info so agent can trim
        if len(content) > MAX_IMMEDIATE_CHARS:
            return (
                f"# Error\n\n"
                f"Content too large: {len(content):,} characters "
                f"(~{len(content) // 4:,} tokens). "
                f"Immediate memory is limited to {MAX_IMMEDIATE_CHARS:,} characters "
                f"(~{MAX_IMMEDIATE_CHARS // 4:,} tokens). "
                f"Trim your content and try again."
            )

        filepath = _immediate_path(active_project.home)

        # Ensure parent directory exists
        filepath.parent.mkdir(parents=True, exist_ok=True)

        filepath.write_text(content, encoding="utf-8")
        token_estimate = len(content) // 4

        logger.info(
            f"MCP tool response: tool=write_immediate_memory project={active_project.name} "
            f"chars={len(content)} tokens_est={token_estimate}"
        )

        return (
            f"# Immediate memory updated\n\n"
            f"- project: {active_project.name}\n"
            f"- file: {filepath}\n"
            f"- size: {len(content):,} characters (~{token_estimate:,} tokens)\n"
            f"- budget: {MAX_IMMEDIATE_CHARS - len(content):,} characters remaining"
        )
