"""Tests for project enforcement in the MCP server.

Validates that BASIC_MEMORY_REQUIRE_PROJECT=true makes 'project' required
in tool schemas, ensuring multi-agent isolation when VS Code spawns
concurrent subagents.
"""

from __future__ import annotations

import pytest

from basic_memory.mcp.server import enforce_project_schemas, EXEMPT_TOOLS


class TestEnforceProjectSchemas:
    """Test the enforce_project_schemas() function that patches tool schemas."""

    def test_patches_tools_with_project_parameter(self):
        """Verify that tools with an optional 'project' param get it promoted to required."""
        import basic_memory.mcp.tools as tools_module

        # Capture original state so we can restore after test
        original_required: dict[str, list[str]] = {}
        for attr_name in tools_module.__all__:
            tool_obj = getattr(tools_module, attr_name, None)
            if tool_obj is None or not hasattr(tool_obj, "parameters"):
                continue
            params = tool_obj.parameters
            if "required" in params:
                original_required[attr_name] = list(params["required"])
            else:
                original_required[attr_name] = []

        try:
            patched = enforce_project_schemas()

            # At least some tools should have been patched
            assert patched > 0, "Expected at least one tool to be patched"

            # Verify patched tools now have 'project' in required
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue

                props = tool_obj.parameters.get("properties", {})
                tool_name = getattr(tool_obj, "name", attr_name)

                if "project" in props and tool_name not in EXEMPT_TOOLS:
                    required = tool_obj.parameters.get("required", [])
                    assert "project" in required, (
                        f"Tool '{tool_name}' has a 'project' property but it's not "
                        f"in required after enforcement. required={required}"
                    )
        finally:
            # Restore original state to avoid polluting other tests
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                if attr_name in original_required:
                    if original_required[attr_name]:
                        tool_obj.parameters["required"] = original_required[attr_name]
                    else:
                        tool_obj.parameters.pop("required", None)

    def test_exempt_tools_are_not_patched(self):
        """Verify that exempt tools keep 'project' as optional."""
        import basic_memory.mcp.tools as tools_module

        # Capture original state
        original_required: dict[str, list[str]] = {}
        for attr_name in tools_module.__all__:
            tool_obj = getattr(tools_module, attr_name, None)
            if tool_obj is None or not hasattr(tool_obj, "parameters"):
                continue
            params = tool_obj.parameters
            original_required[attr_name] = list(params.get("required", []))

        try:
            enforce_project_schemas()

            # Check that exempt tools' project param was NOT made required
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue

                tool_name = getattr(tool_obj, "name", attr_name)
                if tool_name in EXEMPT_TOOLS:
                    props = tool_obj.parameters.get("properties", {})
                    if "project" in props:
                        required = tool_obj.parameters.get("required", [])
                        assert "project" not in required, (
                            f"Exempt tool '{tool_name}' should NOT have 'project' "
                            f"in required, but it does."
                        )
        finally:
            # Restore original state
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                if attr_name in original_required:
                    if original_required[attr_name]:
                        tool_obj.parameters["required"] = original_required[attr_name]
                    else:
                        tool_obj.parameters.pop("required", None)

    def test_idempotent_enforcement(self):
        """Calling enforce_project_schemas twice should not duplicate 'project' in required."""
        import basic_memory.mcp.tools as tools_module

        # Capture original state
        original_required: dict[str, list[str]] = {}
        for attr_name in tools_module.__all__:
            tool_obj = getattr(tools_module, attr_name, None)
            if tool_obj is None or not hasattr(tool_obj, "parameters"):
                continue
            params = tool_obj.parameters
            original_required[attr_name] = list(params.get("required", []))

        try:
            first_patched = enforce_project_schemas()
            second_patched = enforce_project_schemas()

            # Second call should patch 0 tools (already enforced)
            assert second_patched == 0, (
                f"Second enforcement should patch 0 tools, but patched {second_patched}"
            )
            assert first_patched > 0

            # Check no duplicate 'project' entries in required lists
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                required = tool_obj.parameters.get("required", [])
                project_count = required.count("project")
                assert project_count <= 1, (
                    f"Tool '{attr_name}' has 'project' {project_count} times in required"
                )
        finally:
            # Restore original state
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                if attr_name in original_required:
                    if original_required[attr_name]:
                        tool_obj.parameters["required"] = original_required[attr_name]
                    else:
                        tool_obj.parameters.pop("required", None)

    def test_tools_without_project_param_are_skipped(self):
        """Tools that don't have a 'project' property should be unaffected."""
        import basic_memory.mcp.tools as tools_module

        # Capture original state
        original_required: dict[str, list[str]] = {}
        for attr_name in tools_module.__all__:
            tool_obj = getattr(tools_module, attr_name, None)
            if tool_obj is None or not hasattr(tool_obj, "parameters"):
                continue
            original_required[attr_name] = list(
                tool_obj.parameters.get("required", [])
            )

        try:
            enforce_project_schemas()

            # Tools without 'project' in properties should not be touched
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                props = tool_obj.parameters.get("properties", {})
                if "project" not in props:
                    # Required list should be unchanged
                    current_required = tool_obj.parameters.get("required", [])
                    assert current_required == original_required.get(attr_name, []), (
                        f"Tool '{attr_name}' without project param had its required "
                        f"list modified unexpectedly"
                    )
        finally:
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                if attr_name in original_required:
                    if original_required[attr_name]:
                        tool_obj.parameters["required"] = original_required[attr_name]
                    else:
                        tool_obj.parameters.pop("required", None)


class TestEnforcementInLifespan:
    """Test that the lifespan function respects BASIC_MEMORY_REQUIRE_PROJECT."""

    @pytest.mark.asyncio
    async def test_lifespan_with_enforcement_enabled(self, config_manager, monkeypatch):
        """Verify that setting the env var triggers enforcement during lifespan."""
        import basic_memory.mcp.tools as tools_module
        from basic_memory.mcp.server import lifespan, mcp

        monkeypatch.setenv("BASIC_MEMORY_REQUIRE_PROJECT", "true")

        # Capture original state
        original_required: dict[str, list[str]] = {}
        for attr_name in tools_module.__all__:
            tool_obj = getattr(tools_module, attr_name, None)
            if tool_obj is None or not hasattr(tool_obj, "parameters"):
                continue
            original_required[attr_name] = list(
                tool_obj.parameters.get("required", [])
            )

        try:
            async with lifespan(mcp):
                # During lifespan, tools should have project enforced
                for attr_name in tools_module.__all__:
                    tool_obj = getattr(tools_module, attr_name, None)
                    if tool_obj is None or not hasattr(tool_obj, "parameters"):
                        continue
                    props = tool_obj.parameters.get("properties", {})
                    tool_name = getattr(tool_obj, "name", attr_name)
                    if "project" in props and tool_name not in EXEMPT_TOOLS:
                        required = tool_obj.parameters.get("required", [])
                        assert "project" in required, (
                            f"Tool '{tool_name}' should have project required "
                            f"during lifespan with enforcement enabled"
                        )
        finally:
            # Restore original state
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                if attr_name in original_required:
                    if original_required[attr_name]:
                        tool_obj.parameters["required"] = original_required[attr_name]
                    else:
                        tool_obj.parameters.pop("required", None)

    @pytest.mark.asyncio
    async def test_lifespan_without_enforcement(self, config_manager, monkeypatch):
        """Verify that without the env var, no enforcement happens."""
        import basic_memory.mcp.tools as tools_module
        from basic_memory.mcp.server import lifespan, mcp

        monkeypatch.delenv("BASIC_MEMORY_REQUIRE_PROJECT", raising=False)

        # Capture state before
        required_before: dict[str, list[str]] = {}
        for attr_name in tools_module.__all__:
            tool_obj = getattr(tools_module, attr_name, None)
            if tool_obj is None or not hasattr(tool_obj, "parameters"):
                continue
            required_before[attr_name] = list(
                tool_obj.parameters.get("required", [])
            )

        async with lifespan(mcp):
            # State should be unchanged
            for attr_name in tools_module.__all__:
                tool_obj = getattr(tools_module, attr_name, None)
                if tool_obj is None or not hasattr(tool_obj, "parameters"):
                    continue
                current_required = list(
                    tool_obj.parameters.get("required", [])
                )
                assert current_required == required_before[attr_name], (
                    f"Tool '{attr_name}' required list changed without "
                    f"enforcement enabled"
                )
