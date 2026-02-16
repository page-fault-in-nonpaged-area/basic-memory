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
exports.AgentLoaderViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
class AgentLoaderViewProvider {
    extensionUri;
    workspaceRoot;
    secrets;
    agentListProvider;
    static viewType = 'agentLoader';
    _view;
    constructor(extensionUri, workspaceRoot, secrets, agentListProvider) {
        this.extensionUri = extensionUri;
        this.workspaceRoot = workspaceRoot;
        this.secrets = secrets;
        this.agentListProvider = agentListProvider;
    }
    async resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = await this._getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'saveSkillsRepo':
                    await this.secrets.store('bm-controls.skillsRepo', msg.value);
                    break;
                case 'saveAgentsRepo':
                    await this.secrets.store('bm-controls.agentsRepo', msg.value);
                    break;
                case 'loadSkills':
                    await this.loadFromRepo(msg.repo, 'skills', msg.pat);
                    break;
                case 'loadAgents':
                    await this.loadFromRepo(msg.repo, 'agents', msg.pat);
                    break;
                case 'ready':
                    await this.sendInitialState();
                    break;
            }
        });
    }
    async sendInitialState() {
        // Migrate old secret keys from agent-memory → bm-controls
        const oldSkills = await this.secrets.get('agent-memory.skillsRepo');
        const oldAgents = await this.secrets.get('agent-memory.agentsRepo');
        if (oldSkills) {
            await this.secrets.store('bm-controls.skillsRepo', oldSkills);
            await this.secrets.delete('agent-memory.skillsRepo');
        }
        if (oldAgents) {
            await this.secrets.store('bm-controls.agentsRepo', oldAgents);
            await this.secrets.delete('agent-memory.agentsRepo');
        }
        const skillsRepo = await this.secrets.get('bm-controls.skillsRepo') ?? '';
        const agentsRepo = await this.secrets.get('bm-controls.agentsRepo') ?? '';
        // Count agents in project
        const agentsDir = path.join(this.workspaceRoot, '.github', 'agents');
        let agentCount = 0;
        if (fs.existsSync(agentsDir)) {
            const files = fs.readdirSync(agentsDir);
            agentCount = files.filter(f => f.endsWith('.agent.md')).length;
        }
        this._postMessage({
            type: 'init',
            skillsRepo,
            agentsRepo,
            agentCount
        });
    }
    _postMessage(msg) {
        this._view?.webview.postMessage(msg);
    }
    // ── GitHub download logic ──────────────────────────────────────────
    async loadFromRepo(repoUrl, kind, pat) {
        if (!repoUrl) {
            vscode.window.showErrorMessage(`No ${kind} repository URL set`);
            return;
        }
        if (!pat) {
            vscode.window.showErrorMessage('GitHub PAT token is required');
            return;
        }
        const parsed = this.parseGitHubUrl(repoUrl);
        if (!parsed) {
            vscode.window.showErrorMessage(`Invalid GitHub URL: ${repoUrl}`);
            return;
        }
        this._postMessage({ type: 'loading', kind });
        try {
            const contents = await this.listRepoContents(parsed.owner, parsed.repo, parsed.path, pat);
            if (contents.length === 0) {
                vscode.window.showWarningMessage(`No files found in ${repoUrl}`);
                this._postMessage({ type: 'loadComplete', kind, count: 0 });
                return;
            }
            const targetDir = kind === 'agents'
                ? path.join(this.workspaceRoot, '.github', 'agents')
                : path.join(this.workspaceRoot, '.agents', 'skills');
            fs.mkdirSync(targetDir, { recursive: true });
            let downloaded = 0;
            for (const item of contents) {
                if (item.type === 'file' && item.download_url) {
                    const content = await this.downloadFile(item.download_url, pat);
                    const filePath = path.join(targetDir, item.name);
                    fs.writeFileSync(filePath, content, 'utf-8');
                    downloaded++;
                }
                else if (item.type === 'dir') {
                    // Recurse into subdirs for skills
                    await this.downloadDir(parsed.owner, parsed.repo, item.path, path.join(targetDir, item.name), pat);
                    downloaded++;
                }
            }
            this.agentListProvider.refresh();
            this._postMessage({ type: 'loadComplete', kind, count: downloaded });
            vscode.window.showInformationMessage(`Loaded ${downloaded} ${kind} from ${parsed.owner}/${parsed.repo}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to load ${kind}: ${message}`);
            this._postMessage({ type: 'loadError', kind, error: message });
        }
    }
    async downloadDir(owner, repo, repoPath, localDir, pat) {
        fs.mkdirSync(localDir, { recursive: true });
        const contents = await this.listRepoContents(owner, repo, repoPath, pat);
        for (const item of contents) {
            if (item.type === 'file' && item.download_url) {
                const content = await this.downloadFile(item.download_url, pat);
                fs.writeFileSync(path.join(localDir, item.name), content, 'utf-8');
            }
            else if (item.type === 'dir') {
                await this.downloadDir(owner, repo, item.path, path.join(localDir, item.name), pat);
            }
        }
    }
    parseGitHubUrl(url) {
        // Handles:
        //   https://github.com/owner/repo
        //   https://github.com/owner/repo/tree/main/some/path
        //   owner/repo
        //   owner/repo/path
        const cleaned = url.replace(/\/+$/, '').replace(/\.git$/, '');
        // Full URL
        const fullMatch = cleaned.match(/(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/[^\/]+\/(.+))?/);
        if (fullMatch) {
            return { owner: fullMatch[1], repo: fullMatch[2], path: fullMatch[3] || '' };
        }
        // Short form: owner/repo or owner/repo/path
        const shortMatch = cleaned.match(/^([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
        if (shortMatch) {
            return { owner: shortMatch[1], repo: shortMatch[2], path: shortMatch[3] || '' };
        }
        return null;
    }
    listRepoContents(owner, repo, repoPath, pat) {
        const apiPath = repoPath
            ? `/repos/${owner}/${repo}/contents/${repoPath}`
            : `/repos/${owner}/${repo}/contents`;
        return this.githubGet(apiPath, pat);
    }
    githubGet(apiPath, pat) {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': 'vscode-bm-controls',
                'Accept': 'application/vnd.github.v3+json'
            };
            if (pat) {
                headers['Authorization'] = `Bearer ${pat}`;
            }
            const req = https.get({
                hostname: 'api.github.com',
                path: apiPath,
                headers
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`GitHub API ${res.statusCode}: ${data.substring(0, 200)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        reject(new Error(`Failed to parse response: ${data.substring(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
        });
    }
    downloadFile(url, pat) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const headers = {
                'User-Agent': 'vscode-bm-controls'
            };
            if (pat) {
                headers['Authorization'] = `Bearer ${pat}`;
            }
            const req = https.get({
                hostname: parsed.hostname,
                path: parsed.pathname,
                headers
            }, (res) => {
                // Follow redirects
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const location = res.headers.location;
                    if (location) {
                        this.downloadFile(location, pat).then(resolve, reject);
                        return;
                    }
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Download failed ${res.statusCode}`));
                        return;
                    }
                    resolve(data);
                });
            });
            req.on('error', reject);
        });
    }
    // ── HTML ───────────────────────────────────────────────────────────
    async _getHtml(_webview) {
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
        padding: 0 12px 12px 12px;
        margin: 0;
    }
    .section {
        margin-bottom: 16px;
    }
    label {
        display: block;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin: 14px 0 6px 0;
        font-weight: 500;
    }
    .input-row {
        display: flex;
        align-items: stretch;
        gap: 9px;
    }
    input[type="text"], input[type="password"] {
        flex: 1;
        box-sizing: border-box;
        padding: 6px 10px;
        font-size: 12px;
        font-family: var(--vscode-editor-font-family);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 0;
        outline: none;
    }
    input[type="password"] {
        width: 100%;
    }
    input:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }
    .load-btn {
        padding: 6px 16px;
        font-size: 12px;
        font-weight: 500;
        font-family: var(--vscode-font-family);
        color: white;
        background: #007acc;
        border: none;
        border-radius: 0;
        cursor: pointer;
        transition: background 0.15s ease, opacity 0.15s ease;
        white-space: nowrap;
    }
    .load-btn:hover {
        background: #005a9e;
    }
    .load-btn:active {
        background: #004578;
    }
    .load-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .status {
        font-size: 11px;
        margin-top: 6px;
        color: var(--vscode-descriptionForeground);
    }
    .status.success {
        color: var(--vscode-testing-iconPassed);
    }
    .status.error {
        color: var(--vscode-testing-iconFailed);
    }
    .help-section {
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 12px;
        background: var(--vscode-textCodeBlock-background);
        border-radius: 3px;
        margin-bottom: 16px;
        font-size: 11px;
        line-height: 1.5;
    }
    .help-section.hidden {
        display: none;
    }
    .help-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        margin-bottom: 6px;
        font-size: 12px;
    }
    .help-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
    }
    .help-content {
        flex: 1;
    }
    .help-text {
        color: var(--vscode-descriptionForeground);
    }
    .help-code {
        font-family: var(--vscode-editor-font-family);
        background: var(--vscode-textPreformat-background);
        padding: 2px 4px;
        border-radius: 2px;
        font-size: 10px;
    }
    .dismiss-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        padding: 2px;
        opacity: 0.5;
        transition: opacity 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .dismiss-btn:hover {
        opacity: 1;
    }
</style>
</head>
<body>
    <div class="section">

            <label>GitHub PAT Token</label>
            <input type="password" id="patInput" placeholder="ghp_..." />

            <label>Agent skills repository</label>
            <div class="input-row">
                <input type="text" id="skillsRepo" placeholder="owner/repo or full GitHub URL" />
                <button class="load-btn" id="loadSkills">Load</button>
            </div>
            <div class="status" id="skillsStatus"></div>

            <label>Agents repository</label>
            <div class="input-row">
                <input type="text" id="agentsRepo" placeholder="owner/repo or full GitHub URL" />
                <button class="load-btn" id="loadAgents">Load</button>
            </div>
            <div class="status" id="agentsStatus"></div>

    </div>

<script>
    const vscode = acquireVsCodeApi();

    // Elements
    const patInput = document.getElementById('patInput');
    const skillsRepo = document.getElementById('skillsRepo');
    const loadSkillsBtn = document.getElementById('loadSkills');
    const skillsStatus = document.getElementById('skillsStatus');
    const agentsRepo = document.getElementById('agentsRepo');
    const loadAgentsBtn = document.getElementById('loadAgents');
    const agentsStatus = document.getElementById('agentsStatus');

    // Initialize lucide icons
    lucide.createIcons();

    // Load buttons - send PAT with each request
    loadSkillsBtn.addEventListener('click', () => {
        vscode.postMessage({ 
            type: 'loadSkills', 
            repo: skillsRepo.value,
            pat: patInput.value
        });
    });
    loadAgentsBtn.addEventListener('click', () => {
        vscode.postMessage({ 
            type: 'loadAgents', 
            repo: agentsRepo.value,
            pat: patInput.value
        });
    });

    // Save repos on change
    skillsRepo.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveSkillsRepo', value: skillsRepo.value });
    });
    agentsRepo.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveAgentsRepo', value: agentsRepo.value });
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.type) {
            case 'init':
                skillsRepo.value = msg.skillsRepo || '';
                agentsRepo.value = msg.agentsRepo || '';
                break;

            case 'loading':
                const loadingEl = msg.kind === 'skills' ? skillsStatus : agentsStatus;
                const loadingBtn = msg.kind === 'skills' ? loadSkillsBtn : loadAgentsBtn;
                loadingEl.textContent = 'Loading...';
                loadingEl.className = 'status';
                loadingBtn.disabled = true;
                break;

            case 'loadComplete':
                const completeEl = msg.kind === 'skills' ? skillsStatus : agentsStatus;
                const completeBtn = msg.kind === 'skills' ? loadSkillsBtn : loadAgentsBtn;
                completeEl.textContent = '✓ Loaded ' + msg.count + ' items';
                completeEl.className = 'status success';
                completeBtn.disabled = false;
                break;

            case 'loadError':
                const errorEl = msg.kind === 'skills' ? skillsStatus : agentsStatus;
                const errorBtn = msg.kind === 'skills' ? loadSkillsBtn : loadAgentsBtn;
                errorEl.textContent = '✗ ' + msg.error;
                errorEl.className = 'status error';
                errorBtn.disabled = false;
                break;
        }
    });

    // Ready
    vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
exports.AgentLoaderViewProvider = AgentLoaderViewProvider;
//# sourceMappingURL=agentLoader.js.map