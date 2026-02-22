"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BmSetupViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const FORK_REPO = 'git+https://github.com/page-fault-in-nonpaged-area/basic-memory@fork-extensions';
class BmSetupViewProvider {
    extensionUri;
    workspaceRoot;
    static viewType = 'bmSetup';
    _view;
    _serverTerminal;
    constructor(extensionUri, workspaceRoot) {
        this.extensionUri = extensionUri;
        this.workspaceRoot = workspaceRoot;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this._getHtml();
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'install':
                    this.installBasicMemory();
                    break;
                case 'start':
                    this.startBasicMemory();
                    break;
                case 'stop':
                    this.stopBasicMemory();
                    break;
                case 'checkStatus':
                    this.checkStatus();
                    break;
                case 'syncDb':
                    this.syncDatabase();
                    break;
            }
        });
    }
    // --- Commands (registered in extension.ts) ---
    installBasicMemory() {
        const terminal = vscode.window.createTerminal({
            name: 'Install Basic Memory',
            cwd: this.workspaceRoot
        });
        terminal.show();
        // Detect OS and install uv if not present, then install Basic Memory
        const installScript = this.getInstallScript();
        terminal.sendText(installScript);
    }
    getInstallScript() {
        // Check if uv is installed, if not install it based on OS
        const script = `
# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "UV not found. Installing UV..."
    
    # Detect OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            echo "Using Homebrew to install UV..."
            brew install uv
        else
            echo "Installing UV via curl..."
            curl -LsSf https://astral.sh/uv/install.sh | sh
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        echo "Installing UV via curl..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
    else
        echo "Unsupported OS: $OSTYPE"
        echo "Please install UV manually from https://docs.astral.sh/uv/"
        exit 1
    fi
    
    # Source the shell config to update PATH
    if [ -f "$HOME/.cargo/env" ]; then
        source "$HOME/.cargo/env"
    fi
    
    echo "UV installed successfully!"
else
    echo "UV is already installed."
fi

# Create workspace directories
echo "Setting up workspace directories..."
mkdir -p "${this.workspaceRoot}/.github/agents"
mkdir -p "${this.workspaceRoot}/.memory-mcp"
mkdir -p "${this.workspaceRoot}/.agent-projects"
mkdir -p "${this.workspaceRoot}/.vscode"
echo "Created workspace directories"

# Discover and create agent project directories from .github/agents
echo "Setting up agent project directories..."
if [ -d "${this.workspaceRoot}/.github/agents" ]; then
    for agent_file in "${this.workspaceRoot}/.github/agents"/*.agent.md; do
        if [ -f "$agent_file" ]; then
            agent_name=$(basename "$agent_file" .agent.md)
            agent_dir="${this.workspaceRoot}/.agent-projects/$agent_name"
            if [ ! -d "$agent_dir" ]; then
                mkdir -p "$agent_dir"
                echo "Created agent project directory: $agent_name"
            else
                echo "Agent project directory already exists: $agent_name"
            fi
        fi
    done
else
    echo "No .github/agents directory found, skipping agent project setup"
fi

# Set up gemini-engineer project directory if GEMINI.md is present
if [ -f "${this.workspaceRoot}/GEMINI.md" ]; then
    gemini_dir="${this.workspaceRoot}/.agent-projects/gemini-engineer"
    if [ ! -d "$gemini_dir" ]; then
        mkdir -p "$gemini_dir"
        echo "Created gemini-engineer project directory (detected GEMINI.md)"
    else
        echo "gemini-engineer project directory already exists"
    fi
fi
# Initialize agent-controls.json if it doesn't exist
if [ ! -f "${this.workspaceRoot}/.memory-mcp/agent-controls.json" ]; then
    echo "Initializing agent-controls.json..."
    cat > "${this.workspaceRoot}/.memory-mcp/agent-controls.json" << 'EOF'
{
  "agents": {}
}
EOF
    echo "Created agent-controls.json"
fi

# Create config.json with agent projects dynamically
echo "Creating config.json with agent projects..."
cat > "${this.workspaceRoot}/.memory-mcp/config.json" << 'CONFIGEOF'
{
  "env": "dev",
  "projects": {
CONFIGEOF

# Add each agent as a project entry
first=true
default_project=""
for agent_file in "${this.workspaceRoot}/.github/agents"/*.agent.md; do
    if [ -f "$agent_file" ]; then
        agent_name=$(basename "$agent_file" .agent.md)
        agent_path="${this.workspaceRoot}/.agent-projects/$agent_name"
        
        if [ "$first" = true ]; then
            default_project="$agent_name"
            echo "    \\"$agent_name\\": \\"$agent_path\\"" >> "${this.workspaceRoot}/.memory-mcp/config.json"
            first=false
        else
            # Add comma before subsequent entries
            sed -i '$ s/$/,/' "${this.workspaceRoot}/.memory-mcp/config.json"
            echo "    \\"$agent_name\\": \\"$agent_path\\"" >> "${this.workspaceRoot}/.memory-mcp/config.json"
        fi
    fi
done

# Add gemini-engineer to config.json if GEMINI.md exists
if [ -f "${this.workspaceRoot}/GEMINI.md" ]; then
    gemini_path="${this.workspaceRoot}/.agent-projects/gemini-engineer"
    mkdir -p "$gemini_path"
    if [ "$first" = true ]; then
        default_project="gemini-engineer"
        echo "    \\"gemini-engineer\\": \\"$gemini_path\\"" >> "${this.workspaceRoot}/.memory-mcp/config.json"
        first=false
    else
        sed -i '$ s/$/,/' "${this.workspaceRoot}/.memory-mcp/config.json"
        echo "    \\"gemini-engineer\\": \\"$gemini_path\\"" >> "${this.workspaceRoot}/.memory-mcp/config.json"
    fi
fi

# Complete the config.json with the rest of the settings
cat >> "${this.workspaceRoot}/.memory-mcp/config.json" << CONFIGEOF2
  },
  "default_project": "$default_project",
  "default_project_mode": false,
  "log_level": "INFO",
  "database_backend": "sqlite",
  "database_url": null,
  "semantic_search_enabled": false,
  "semantic_embedding_provider": "fastembed",
  "semantic_embedding_model": "bge-small-en-v1.5",
  "semantic_embedding_dimensions": null,
  "semantic_embedding_batch_size": 64,
  "semantic_vector_k": 100,
  "db_pool_size": 20,
  "db_pool_overflow": 40,
  "db_pool_recycle": 180,
  "sync_delay": 1000,
  "watch_project_reload_interval": 300,
  "update_permalinks_on_move": false,
  "sync_changes": true,
  "sync_thread_pool_size": 4,
  "sync_max_concurrent_files": 10,
  "kebab_filenames": false,
  "disable_permalinks": false,
  "skip_initialization_sync": false,
  "format_on_save": false,
  "formatter_command": null,
  "formatters": {},
  "formatter_timeout": 5.0,
  "project_root": null,
  "cloud_client_id": "client_01K6KWQPW6J1M8VV7R3TZP5A6M",
  "cloud_domain": "https://eloquent-lotus-05.authkit.app",
  "cloud_host": "https://cloud.basicmemory.com",
  "cloud_mode": false,
  "cloud_projects": {}
}
CONFIGEOF2
echo "Created config.json with discovered agent projects"

# Create .vscode/mcp.json for MCP configuration (always overwrite to ensure correct config)
echo "Creating .vscode/mcp.json..."
cat > "${this.workspaceRoot}/.vscode/mcp.json" << MCPEOF
{
  "servers": {
    "basic-memory": {
      "command": "${this.workspaceRoot}/.venv/bin/basic-memory",
      "args": ["mcp"],
      "type": "stdio",
      "cwd": "${this.workspaceRoot}",
      "env": {
        "BASIC_MEMORY_REQUIRE_PROJECT": "true",
        "BASIC_MEMORY_CONFIG_DIR": "${this.workspaceRoot}/.memory-mcp"
      }
    }
  }
}
MCPEOF
echo "Created .vscode/mcp.json with absolute paths"

# Setup virtual environment
echo "Setting up Python virtual environment..."
if [ ! -d "${this.workspaceRoot}/.venv" ]; then
    echo "Creating .venv..."
    uv venv "${this.workspaceRoot}/.venv"
    echo "Created .venv"
else
    echo ".venv already exists"
fi

# Install Basic Memory from GitHub repository
echo "Installing Basic Memory from GitHub..."
cd "${this.workspaceRoot}"
echo "Using Python: ${this.workspaceRoot}/.venv/bin/python"

# Check if we're in the basic-memory source directory
if [ -f "${this.workspaceRoot}/pyproject.toml" ] && grep -q "name = \\"basic-memory\\"" "${this.workspaceRoot}/pyproject.toml" 2>/dev/null; then
    echo "Detected basic-memory source directory - installing in editable mode..."
    uv pip install --python "${this.workspaceRoot}/.venv/bin/python" --force-reinstall -e "${this.workspaceRoot}"
else
    echo "Installing from GitHub repository..."
    uv pip install --python "${this.workspaceRoot}/.venv/bin/python" --force-reinstall ${FORK_REPO}
fi

if [ $? -eq 0 ]; then
    echo "Verifying basic-memory installation..."
    if [ -f "${this.workspaceRoot}/.venv/bin/basic-memory" ]; then
        echo "✓ Basic Memory installed successfully!"
    else
        echo "ERROR: basic-memory binary not found after installation"
        echo "Checking installation location..."
        "${this.workspaceRoot}/.venv/bin/python" -m pip show basic-memory
        exit 1
    fi
else
    echo "ERROR: Failed to install Basic Memory"
    echo "Retrying with verbose output..."
    if [ -f "${this.workspaceRoot}/pyproject.toml" ] && grep -q "name = \\"basic-memory\\"" "${this.workspaceRoot}/pyproject.toml" 2>/dev/null; then
        uv pip install --python "${this.workspaceRoot}/.venv/bin/python" -v --force-reinstall -e "${this.workspaceRoot}"
    else
        uv pip install --python "${this.workspaceRoot}/.venv/bin/python" -v --force-reinstall ${FORK_REPO}
    fi
    if [ $? -ne 0 ]; then
        echo "FATAL: Installation failed. Please check the error messages above."
        exit 1
    fi
fi

echo ""

# Register agent projects with basic-memory
echo "Registering agent projects with Basic Memory..."
if [ -d "${this.workspaceRoot}/.github/agents" ]; then
    for agent_file in "${this.workspaceRoot}/.github/agents"/*.agent.md; do
        if [ -f "$agent_file" ]; then
            agent_name=$(basename "$agent_file" .agent.md)
            agent_path="${this.workspaceRoot}/.agent-projects/$agent_name"
            
            echo "Registering project: $agent_name -> $agent_path"
            "${this.workspaceRoot}/.venv/bin/basic-memory" project add "$agent_name" "$agent_path" 2>&1 || {
                echo "Warning: Failed to register project $agent_name (may already exist)"
            }
        fi
    done
    echo "✓ Agent projects registered"
else
    echo "No .github/agents directory found, skipping project registration"
fi

# Register gemini-engineer project if GEMINI.md exists
if [ -f "${this.workspaceRoot}/GEMINI.md" ]; then
    echo "Detected GEMINI.md — setting up gemini-engineer project..."
    gemini_path="${this.workspaceRoot}/.agent-projects/gemini-engineer"
    mkdir -p "$gemini_path"
    "${this.workspaceRoot}/.venv/bin/basic-memory" project add "gemini-engineer" "$gemini_path" 2>&1 || {
        echo "Warning: gemini-engineer project may already exist"
    }
    echo "✓ gemini-engineer project ready"
fi

echo ""
echo "✓ Installation complete!"
echo "✓ Virtual environment: ${this.workspaceRoot}/.venv"
echo "✓ MCP config: ${this.workspaceRoot}/.vscode/mcp.json"
echo ""
echo "Next steps:"
echo "1. Reload VS Code window (Ctrl+Shift+P -> 'Developer: Reload Window')"
echo "2. Click 'Start' to launch the MCP server"
`;
        return script.trim();
    }
    startBasicMemory() {
        // Dispose old terminal if it exists
        if (this._serverTerminal) {
            this._serverTerminal.dispose();
        }
        this._serverTerminal = vscode.window.createTerminal({
            name: 'Basic Memory MCP',
            cwd: this.workspaceRoot,
            env: {
                BASIC_MEMORY_REQUIRE_PROJECT: 'true',
                BASIC_MEMORY_CONFIG_DIR: `${this.workspaceRoot}/.memory-mcp`
            }
        });
        this._serverTerminal.sendText('.venv/bin/basic-memory mcp');
        this._serverTerminal.show();
    }
    stopBasicMemory() {
        // Dispose the terminal first
        if (this._serverTerminal) {
            this._serverTerminal.dispose();
            this._serverTerminal = undefined;
        }
        // Kill only the MCP server for THIS workspace (multi-window safe)
        // Reads PID from the .mcp.lock file and kills only that process
        const terminal = vscode.window.createTerminal({
            name: 'Stop Basic Memory',
            cwd: this.workspaceRoot
        });
        terminal.show();
        terminal.sendText(`
if [ -f ".memory-mcp/.mcp.lock" ]; then
    PID=$(cat .memory-mcp/.mcp.lock 2>/dev/null)
    if [ -n "$PID" ]; then
        kill $PID 2>/dev/null && echo "Stopped MCP server (PID $PID)" || echo "Process $PID not found"
    else
        echo "Lock file empty"
    fi
else
    echo "No MCP server running in this workspace"
fi
        `.trim());
        // Auto-close terminal after a short delay
        setTimeout(() => {
            terminal.dispose();
        }, 2000);
    }
    checkStatus() {
        // Open a terminal to check status
        const terminal = vscode.window.createTerminal({
            name: 'Basic Memory Status',
            cwd: this.workspaceRoot
        });
        terminal.show();
        terminal.sendText('echo "=== Virtual Environment ===" && ls -la .venv/bin/basic-memory 2>&1 && echo "" && echo "=== Basic Memory Version ===" && .venv/bin/basic-memory --version');
    }
    syncDatabase() {
        const terminal = vscode.window.createTerminal({
            name: 'Basic Memory Sync',
            cwd: this.workspaceRoot,
            env: {
                BASIC_MEMORY_CONFIG_DIR: `${this.workspaceRoot}/.memory-mcp`
            }
        });
        terminal.show();
        terminal.sendText('.venv/bin/basic-memory doctor --local');
    }
    _getHtml() {
        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://unpkg.com/lucide@latest"></script>
<style>
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        padding: 12px;
        margin: 0;
    }
    .info-box {
        padding: 12px;
        background: var(--vscode-textCodeBlock-background);
        border-radius: 3px;
        margin-bottom: 16px;
        font-size: 11px;
        line-height: 1.5;
        color: var(--vscode-descriptionForeground);
    }
    .btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 500;
        font-family: var(--vscode-font-family);
        border: none;
        border-radius: 2px;
        cursor: pointer;
        transition: background 0.15s ease;
        margin-bottom: 8px;
    }
    .btn-primary {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
    }
    .btn-primary:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
        color: var(--vscode-button-secondaryForeground);
        background: var(--vscode-button-secondaryBackground);
    }
    .btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }
    .btn-danger {
        color: white;
        background: var(--vscode-errorForeground);
    }
    .btn-danger:hover {
        opacity: 0.85;
    }
    .icon { width: 16px; height: 16px; }
    .btn-row {
        display: flex;
        gap: 8px;
        padding: 0 12px 12px 12px;
    }
    .btn-row .btn {
        flex: 1;
        margin-bottom: 0;
        padding: 8px 10px;
    }
</style>
</head>
<body>
    <div class="btn-row">
        <button class="btn btn-secondary" onclick="doInstall()" title="Install">
            <i data-lucide="download" class="icon"></i>
            <span>Install</span>
        </button>
        <button class="btn btn-secondary" onclick="doSyncDb()" title="Diagnose">
            <i data-lucide="stethoscope" class="icon"></i>
            <span>Diagnose</span>
        </button>
    </div>

<script>
    const vscode = acquireVsCodeApi();
    lucide.createIcons();

    function doInstall() {
        vscode.postMessage({ type: 'install' });
    }

    function doSyncDb() {
        vscode.postMessage({ type: 'syncDb' });
    }
</script>
</body>
</html>`;
    }
}
exports.BmSetupViewProvider = BmSetupViewProvider;
//# sourceMappingURL=bmSetupView.js.map