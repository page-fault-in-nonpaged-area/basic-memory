import * as vscode from 'vscode';

const FORK_REPO = 'git+https://github.com/page-fault-in-nonpaged-area/basic-memory';

export class BmSetupViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'bmSetup';

    private _view?: vscode.WebviewView;
    private _serverTerminal?: vscode.Terminal;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly workspaceRoot: string
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
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

    public installBasicMemory(): void {
        const terminal = vscode.window.createTerminal({
            name: 'Install Basic Memory',
            cwd: this.workspaceRoot
        });
        terminal.show();
        
        // Detect OS and install uv if not present, then install Basic Memory
        const installScript = this.getInstallScript();
        terminal.sendText(installScript);
    }

    private getInstallScript(): string {
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

# Install Basic Memory from local repository
echo "Installing Basic Memory from local repository..."
cd "${this.workspaceRoot}"
if [ -f "pyproject.toml" ]; then
    uv tool install --force --editable .
    echo "Basic Memory installed successfully from local repository!"
else
    echo "Error: Not in Basic Memory repository root (pyproject.toml not found)"
    echo "Please open the basic-memory repository folder in VS Code"
    exit 1
fi
`;
        return script.trim();
    }

    public startBasicMemory(): void {
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
        this._serverTerminal.sendText('uv tool run --from . basic-memory mcp');
        this._serverTerminal.show();
    }

    public stopBasicMemory(): void {
        // Dispose the terminal first
        if (this._serverTerminal) {
            this._serverTerminal.dispose();
            this._serverTerminal = undefined;
        }

        // Kill all basic-memory processes for this project
        const terminal = vscode.window.createTerminal({
            name: 'Stop Basic Memory',
            cwd: this.workspaceRoot
        });
        terminal.show();
        terminal.sendText('pkill -f "basic-memory.*mcp" || echo "No basic-memory processes found"');
        
        // Auto-close terminal after a short delay
        setTimeout(() => {
            terminal.dispose();
        }, 2000);
    }

    public checkStatus(): void {
        // Open a terminal to check status
        const terminal = vscode.window.createTerminal({
            name: 'Basic Memory Status',
            cwd: this.workspaceRoot
        });
        terminal.show();
        terminal.sendText('echo "=== UV Tool List ===" && uv tool list && echo "" && echo "=== Basic Memory Version ===" && uv tool run basic-memory --version');
    }

    public syncDatabase(): void {
        const terminal = vscode.window.createTerminal({
            name: 'Basic Memory Sync',
            cwd: this.workspaceRoot,
            env: {
                BASIC_MEMORY_CONFIG_DIR: `${this.workspaceRoot}/.memory-mcp`
            }
        });
        terminal.show();
        terminal.sendText('uv run basic-memory doctor --local');
    }

    private _getHtml(): string {
        return /*html*/`<!DOCTYPE html>
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
    .btn-row .btn span {
        display: none;
    }
</style>
</head>
<body>
    <div class="btn-row">
        <button class="btn btn-secondary" onclick="doInstall()" title="Install">
            <i data-lucide="download" class="icon"></i>
            <span>Install</span>
        </button>
        <button class="btn btn-primary" onclick="doStart()" title="Start">
            <i data-lucide="play" class="icon"></i>
            <span>Start</span>
        </button>
        <button class="btn btn-secondary" onclick="doStop()" title="Stop">
            <i data-lucide="square" class="icon"></i>
            <span>Stop</span>
        </button>
        <button class="btn btn-secondary" onclick="doSyncDb()" title="Sync DB">
            <i data-lucide="database" class="icon"></i>
            <span>Sync DB</span>
        </button>
    </div>

<script>
    const vscode = acquireVsCodeApi();
    lucide.createIcons();

    function doInstall() {
        vscode.postMessage({ type: 'install' });
    }

    function doStart() {
        vscode.postMessage({ type: 'start' });
    }

    function doStop() {
        vscode.postMessage({ type: 'stop' });
    }

    function doSyncDb() {
        vscode.postMessage({ type: 'syncDb' });
    }
</script>
</body>
</html>`;
    }
}
