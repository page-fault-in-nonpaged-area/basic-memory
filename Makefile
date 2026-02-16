# Makefile for Basic Memory Fork Extensions
# Manages VSCode extension build and installation

.PHONY: help mcp-build mcp-install vscode-build vscode-install vscode-clean vscode-dev dev

# Default target
help:
	@echo "Basic Memory Fork Extensions - Makefile"
	@echo ""
	@echo "MCP Targets:"
	@echo "  mcp-build       - Install MCP server in editable mode"
	@echo "  mcp-install     - Alias for mcp-build"
	@echo ""
	@echo "VSCode Extension Targets:"
	@echo "  vscode-build    - Build the VSCode extension (.vsix package)"
	@echo "  vscode-install  - Install the built extension into VSCode"
	@echo "  vscode-clean    - Clean build artifacts"
	@echo "  vscode-dev      - Build and install in one step"
	@echo ""
	@echo "Combined:"
	@echo "  dev             - Build MCP + VSCode extension and install both"
	@echo ""
	@echo "Usage:"
	@echo "  make mcp-build       # Install MCP server from fork"
	@echo "  make vscode-dev      # Build + install VSCode extension"
	@echo "  make dev             # Build everything"

# Build/install the forked MCP server
mcp-build:
	@echo "=== Building MCP Server ==="
	uv pip install -e ".[dev]"
	uv sync
	@echo ""
	@echo "✓ MCP server installed in editable mode"
	@echo "  Run: basic-memory --version"

mcp-install: mcp-build

# Build the VSCode extension
vscode-build:
	@echo "=== Building VSCode Extension ==="
	@echo "Installing npm dependencies..."
	cd vscode && npm install
	@echo ""
	@echo "Compiling TypeScript..."
	cd vscode && npm run compile
	@echo ""
	@echo "Packaging extension..."
	cd vscode && npm run package
	@echo ""
	@echo "✓ Extension built successfully!"
	@ls -lh vscode/*.vsix

# Install the VSCode extension
vscode-install:
	@echo "=== Installing VSCode Extension ==="
	@if [ ! -f vscode/bm-controls-*.vsix ]; then \
		echo "Error: No .vsix file found. Run 'make vscode-build' first."; \
		exit 1; \
	fi
	@VSIX_FILE=$$(ls vscode/bm-controls-*.vsix | head -1); \
	echo "Installing $$VSIX_FILE..."; \
	code --install-extension "$$VSIX_FILE" --force
	@echo ""
	@echo "✓ Extension installed successfully!"
	@echo ""
	@echo "Note: Reload VSCode for changes to take effect"
	@echo "  Press Ctrl+Shift+P and select 'Developer: Reload Window'"

# Clean build artifacts
vscode-clean:
	@echo "=== Cleaning VSCode Extension Build Artifacts ==="
	rm -rf vscode/out
	rm -rf vscode/node_modules
	rm -f vscode/*.vsix
	@echo "✓ Clean complete"

# Build and install in one step (development workflow)
vscode-dev: vscode-build vscode-install
	@echo ""
	@echo "=== Development Build Complete ==="
	@echo "Extension is ready to use. Reload VSCode to activate."

# Build everything: MCP server + VSCode extension
dev: mcp-build vscode-dev
	@echo ""
	@echo "=== Full Development Build Complete ==="
	@echo "MCP server installed. VSCode extension installed."
	@echo "Reload VSCode for extension changes."
