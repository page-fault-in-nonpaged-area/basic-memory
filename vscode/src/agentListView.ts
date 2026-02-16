import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface AgentStats {
    invocations: number;
    lastInvocation: string;
}

interface AgentControls {
    agents: Record<string, { enabled: boolean; paused: boolean }>;
}

interface AgentData {
    name: string;
    hasQuestions: boolean;
    questionFiles: { filepath: string; title: string }[];
    stats: AgentStats | null;
    memoryCount: number;
    memoryBytes: number;
    memories: MemoryItem[];
    promptPath: string;
    enabled: boolean;
    paused: boolean;
}

interface MemoryItem {
    filename: string;
    filepath: string;
    title: string;
    tags: string;
    modified: string;
    needsHumanInput: boolean;
}

export class AgentListViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agentList';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly workspaceRoot: string
    ) {}

    private getConfiguredProjects(): Map<string, string> {
        const configPath = path.join(this.workspaceRoot, '.memory-mcp', 'config.json');
        const projects = new Map<string, string>();
        
        try {
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf-8');
                const config = JSON.parse(content);
                if (config.projects && typeof config.projects === 'object') {
                    for (const [name, projectPath] of Object.entries(config.projects)) {
                        if (typeof projectPath === 'string') {
                            projects.set(name, projectPath);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Failed to read config.json:', err);
        }
        
        return projects;
    }

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

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'ready':
                    this.sendAgentData();
                    break;

                case 'openFile':
                    try {
                        // Reconstruct original path (sanitization removed apostrophes)
                        // Search for the file by checking if it exists
                        let actualPath = msg.path;
                        if (!fs.existsSync(actualPath)) {
                            // If sanitized path doesn't exist, search for original
                            const dir = path.dirname(actualPath);
                            const basename = path.basename(actualPath);
                            if (fs.existsSync(dir)) {
                                const files = fs.readdirSync(dir);
                                const match = files.find(f => 
                                    f.replace(/'/g, '') === basename
                                );
                                if (match) {
                                    actualPath = path.join(dir, match);
                                }
                            }
                        }
                        const uri = vscode.Uri.file(actualPath);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(doc);
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to open file: ${msg.path}\n${err}`);
                        console.error('Failed to open file:', msg.path, err);
                    }
                    break;

                case 'deleteMemory':
                    const confirm = await vscode.window.showWarningMessage(
                        `Delete memory "${msg.filename}"?`,
                        { modal: true },
                        'Delete'
                    );
                    if (confirm === 'Delete') {
                        try {
                            // Reconstruct original path
                            let actualPath = msg.path;
                            if (!fs.existsSync(actualPath)) {
                                const dir = path.dirname(actualPath);
                                const basename = path.basename(actualPath);
                                if (fs.existsSync(dir)) {
                                    const files = fs.readdirSync(dir);
                                    const match = files.find(f => 
                                        f.replace(/'/g, '') === basename
                                    );
                                    if (match) {
                                        actualPath = path.join(dir, match);
                                    }
                                }
                            }
                            fs.unlinkSync(actualPath);
                            vscode.window.showInformationMessage(`Deleted: ${msg.filename}`);
                            this.sendAgentData();
                        } catch (err) {
                            vscode.window.showErrorMessage(`Failed to delete: ${err}`);
                        }
                    }
                    break;

                case 'newMemory':
                    await this.createNewMemory(msg.agentName);
                    break;

                case 'openImmediateMemory':
                    await this.openImmediateMemory(msg.agentName);
                    break;

                case 'refresh':
                    this.sendAgentData();
                    break;

                case 'togglePause':
                    this.toggleAgentPause(msg.agentName);
                    break;

                case 'toggleEnabled':
                    this.toggleAgentEnabled(msg.agentName);
                    break;
            }
        });

        // Watch for file changes
        const agentsPattern = new vscode.RelativePattern(
            this.workspaceRoot,
            '.github/agents/**/*'
        );
        const watcher = vscode.workspace.createFileSystemWatcher(agentsPattern);
        watcher.onDidCreate(() => this.sendAgentData());
        watcher.onDidDelete(() => this.sendAgentData());
        watcher.onDidChange(() => this.sendAgentData());

        const memoryPattern = new vscode.RelativePattern(
            this.workspaceRoot,
            '.agent-projects/**/*'
        );
        const memoryWatcher = vscode.workspace.createFileSystemWatcher(memoryPattern);
        memoryWatcher.onDidCreate(() => this.sendAgentData());
        memoryWatcher.onDidDelete(() => this.sendAgentData());
        memoryWatcher.onDidChange(() => this.sendAgentData());
    }

    public refresh(): void {
        this.sendAgentData();
    }

    // --- Agent Controls (pause/disable) ---

    private getAgentControlsPath(): string {
        return path.join(this.workspaceRoot, '.memory-mcp', 'agent-controls.json');
    }

    private readAgentControls(): AgentControls {
        const controlsPath = this.getAgentControlsPath();
        try {
            if (fs.existsSync(controlsPath)) {
                const content = fs.readFileSync(controlsPath, 'utf-8');
                return JSON.parse(content) as AgentControls;
            }
        } catch {
            // If file is corrupted, return default
        }
        return { agents: {} };
    }

    private writeAgentControls(controls: AgentControls): void {
        const controlsPath = this.getAgentControlsPath();
        const dir = path.dirname(controlsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(controlsPath, JSON.stringify(controls, null, 2), 'utf-8');
    }

    private getAgentControl(agentName: string): { enabled: boolean; paused: boolean } {
        const controls = this.readAgentControls();
        return controls.agents[agentName] ?? { enabled: true, paused: false };
    }

    private toggleAgentPause(agentName: string): void {
        const controls = this.readAgentControls();
        const current = controls.agents[agentName] ?? { enabled: true, paused: false };
        current.paused = !current.paused;
        controls.agents[agentName] = current;
        this.writeAgentControls(controls);
        this.sendAgentData();
        vscode.window.showInformationMessage(
            `Agent "${agentName}" memory ${current.paused ? 'paused' : 'resumed'}`
        );
    }

    private toggleAgentEnabled(agentName: string): void {
        const controls = this.readAgentControls();
        const current = controls.agents[agentName] ?? { enabled: true, paused: false };
        current.enabled = !current.enabled;
        controls.agents[agentName] = current;
        this.writeAgentControls(controls);
        this.sendAgentData();
        vscode.window.showInformationMessage(
            `Agent "${agentName}" memory ${current.enabled ? 'enabled' : 'disabled'}`
        );
    }

    private sanitizePath(filepath: string): string {
        // Remove dangerous characters that interfere with HTML rendering
        return filepath.replace(/'/g, '');
    }

    private sendAgentData(): void {
        const agents = this.getAgentData();
        this._view?.webview.postMessage({
            type: 'update',
            agents
        });
    }

    private getAgentData(): AgentData[] {
        const agentsDir = path.join(this.workspaceRoot, '.github', 'agents');
        const defaultMemoryBaseDir = path.join(this.workspaceRoot, '.agent-projects');
        
        // Read configured projects from config.json
        const configuredProjects = this.getConfiguredProjects();

        if (!fs.existsSync(agentsDir)) {
            return [];
        }

        const files = fs.readdirSync(agentsDir);
        const agents: AgentData[] = [];

        for (const file of files) {
            if (!file.endsWith('.agent.md')) continue;

            const agentName = file.replace('.agent.md', '');
            const promptPath = path.join(agentsDir, file);

            // Use configured project path if available, otherwise fall back to default
            const memoryBaseDir = configuredProjects.get(agentName) || defaultMemoryBaseDir;

            const stats = this.getAgentStats(agentName, memoryBaseDir);
            const memories = this.getMemories(agentName, memoryBaseDir);
            const questionFiles = memories
                .filter(m => m.needsHumanInput)
                .map(m => ({ filepath: m.filepath, title: m.title || m.filename }));

            const agentControl = this.getAgentControl(agentName);

            // Sanitize paths before sending to webview
            const sanitizedMemories = memories.map(m => ({
                ...m,
                filepath: this.sanitizePath(m.filepath),
                filename: this.sanitizePath(m.filename)
            }));
            const sanitizedQuestionFiles = questionFiles.map(qf => ({
                ...qf,
                filepath: this.sanitizePath(qf.filepath)
            }));

            agents.push({
                name: agentName,
                hasQuestions: questionFiles.length > 0,
                questionFiles: sanitizedQuestionFiles,
                stats,
                memoryCount: memories.length,
                memoryBytes: memories.reduce((sum, m) => {
                    try {
                        return sum + fs.statSync(m.filepath).size;
                    } catch {
                        return sum;
                    }
                }, 0),
                memories: sanitizedMemories,
                promptPath: this.sanitizePath(promptPath),
                enabled: agentControl.enabled,
                paused: agentControl.paused
            });
        }

        return agents.sort((a, b) => a.name.localeCompare(b.name));
    }

    private parseMemoryMetadata(content: string): { title: string; tags: string; needsHumanInput: boolean } {
        const result = { title: '', tags: '', needsHumanInput: false };
        const lines = content.split('\n');

        // Detect format: YAML frontmatter (basic-memory) vs legacy separator format
        if (lines[0]?.trim() === '---') {
            // YAML frontmatter: parse key-value pairs between --- delimiters
            for (let i = 1; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed === '---') break;
                if (trimmed.startsWith('title:')) {
                    result.title = trimmed.replace('title:', '').trim();
                } else if (trimmed.startsWith('tags:')) {
                    // Tags can be inline (tags: a, b) or YAML list (tags:\n- a\n- b)
                    const inline = trimmed.replace('tags:', '').trim();
                    if (inline) {
                        result.tags = inline;
                    } else {
                        // Collect YAML list items
                        const tagItems: string[] = [];
                        for (let j = i + 1; j < lines.length; j++) {
                            const tagLine = lines[j].trim();
                            if (tagLine.startsWith('- ')) {
                                tagItems.push(tagLine.substring(2));
                            } else {
                                break;
                            }
                        }
                        result.tags = tagItems.join(', ');
                    }
                }
            }
        } else {
            // Legacy format: metadata between long separator lines
            const separator = '-----------------------------------------';
            let inMeta = false;
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === separator) {
                    if (!inMeta) {
                        inMeta = true;
                        continue;
                    } else {
                        break;
                    }
                }
                if (inMeta) {
                    if (trimmed.startsWith('[Title]:')) {
                        result.title = trimmed.replace('[Title]:', '').trim();
                    } else if (trimmed.startsWith('[Tags]:')) {
                        result.tags = trimmed.replace('[Tags]:', '').trim();
                    }
                }
            }
        }

        // Check for human input required:
        // 1. Tag "needs-human-input" in frontmatter
        // 2. Banner ">>> Human Input Required <<<" anywhere in file
        const tagsLower = result.tags.toLowerCase();
        result.needsHumanInput = 
            tagsLower.includes('needs-human-input') ||
            content.includes('>>> Human Input Required <<<');
        return result;
    }

    private getAgentStats(agentName: string, memoryBaseDir: string): AgentStats | null {
        // For configured projects, memoryBaseDir IS the project directory
        // For default layout, we need to append the agent name
        const statsPath = memoryBaseDir.includes(agentName) 
            ? path.join(memoryBaseDir, '.stats.json')
            : path.join(memoryBaseDir, agentName, '.stats.json');
        if (!fs.existsSync(statsPath)) return null;

        try {
            const content = fs.readFileSync(statsPath, 'utf-8');
            return JSON.parse(content) as AgentStats;
        } catch {
            return null;
        }
    }

    private getMemories(agentName: string, memoryBaseDir: string): MemoryItem[] {
        // For configured projects, memoryBaseDir IS the project directory
        // For default layout, we need to append the agent name
        const memoryDir = memoryBaseDir.includes(agentName) || fs.existsSync(path.join(memoryBaseDir, '.stats.json'))
            ? memoryBaseDir
            : path.join(memoryBaseDir, agentName);
        if (!fs.existsSync(memoryDir)) return [];

        try {
            const memories: MemoryItem[] = [];
            this.scanMemoriesRecursive(memoryDir, memoryDir, memories);
            return memories.sort((a, b) => a.filename.localeCompare(b.filename));
        } catch {
            return [];
        }
    }

    /** Recursively scan directory tree for .md memory files */
    private scanMemoriesRecursive(baseDir: string, dir: string, memories: MemoryItem[]): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            if (entry.name === '_immediate.md') continue;  // shown as permanent UI entry

            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.scanMemoriesRecursive(baseDir, fullPath, memories);
            } else if (entry.name.endsWith('.md')) {
                const stat = fs.statSync(fullPath);
                const relPath = path.relative(baseDir, fullPath);

                let title = '';
                let tags = '';
                let needsHumanInput = false;
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const meta = this.parseMemoryMetadata(content);
                    title = meta.title;
                    tags = meta.tags;
                    needsHumanInput = meta.needsHumanInput;
                } catch {
                    // If we can't read the file content, just show filename
                }

                memories.push({
                    filename: relPath,
                    filepath: fullPath,
                    title,
                    tags,
                    modified: this.formatDate(stat.mtime),
                    needsHumanInput
                });
            }
        }
    }

    private formatDate(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    }

    private formatTimestamp(iso: string): string {
        try {
            const d = new Date(iso);
            const now = new Date();
            const diff = now.getTime() - d.getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return `${mins}m ago`;
            const hours = Math.floor(mins / 60);
            if (hours < 24) return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            if (days < 7) return `${days}d ago`;
            return d.toLocaleDateString();
        } catch {
            return iso;
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    private async openImmediateMemory(agentName: string): Promise<void> {
        const configuredProjects = this.getConfiguredProjects();
        const defaultMemoryBaseDir = path.join(this.workspaceRoot, '.agent-projects');
        const memoryBaseDir = configuredProjects.get(agentName) || defaultMemoryBaseDir;

        const memoryDir = memoryBaseDir.includes(agentName) || configuredProjects.has(agentName)
            ? memoryBaseDir
            : path.join(memoryBaseDir, agentName);
        const immediatePath = path.join(memoryDir, '_immediate.md');

        if (!fs.existsSync(memoryDir)) {
            fs.mkdirSync(memoryDir, { recursive: true });
        }

        // Create with template if it doesn't exist yet
        if (!fs.existsSync(immediatePath)) {
            const template = [
                '---',
                'title: Immediate Memory',
                'type: immediate',
                'permalink: _immediate',
                'tags: [immediate-memory]',
                '---',
                '',
                '# Immediate Memory',
                '',
                '> Context-limited scratchpad that survives context compaction.',
                '> Keep under 5k tokens. Overwrite freely.',
                '',
                ''
            ].join('\n');
            fs.writeFileSync(immediatePath, template, 'utf-8');
        }

        const doc = await vscode.workspace.openTextDocument(immediatePath);
        await vscode.window.showTextDocument(doc);
    }

    private async createNewMemory(agentName: string): Promise<void> {
        const title = await vscode.window.showInputBox({
            prompt: 'Memory title',
            placeHolder: 'e.g., Docker Command Hangs Indefinitely'
        });
        if (!title) return;

        const slug = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        const filename = `${slug}.md`;

        // Use configured project path if available
        const configuredProjects = this.getConfiguredProjects();
        const defaultMemoryBaseDir = path.join(this.workspaceRoot, '.agent-projects');
        const memoryBaseDir = configuredProjects.get(agentName) || defaultMemoryBaseDir;
        
        // For configured projects, memoryBaseDir IS the project directory
        // For default layout, we need to append the agent name
        const memoryDir = memoryBaseDir.includes(agentName) || configuredProjects.has(agentName)
            ? memoryBaseDir
            : path.join(memoryBaseDir, agentName);
        const memoryPath = path.join(memoryDir, filename);

        if (!fs.existsSync(memoryDir)) {
            fs.mkdirSync(memoryDir, { recursive: true });
        }

        // Write basic-memory compatible YAML frontmatter format
        const permalink = slug;
        const template = [
            '---',
            `title: ${title}`,
            'type: note',
            `permalink: ${permalink}`,
            'tags: []',
            '---',
            '',
            `# ${title}`,
            '',
            '',
            ''
        ].join('\n');

        fs.writeFileSync(memoryPath, template, 'utf-8');

        const doc = await vscode.workspace.openTextDocument(memoryPath);
        await vscode.window.showTextDocument(doc);
        this.sendAgentData();
    }

    private _getHtml(_webview: vscode.Webview): string {
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://unpkg.com/lucide@latest"></script>
<style>
    * { box-sizing: border-box; }
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        padding: 0;
        margin: 0;
    }

    .search-container {
        padding: 12px;
        background: var(--vscode-sideBar-background);
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    .search-input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 2px;
        outline: none;
    }
    .search-input:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }
    .search-input::placeholder {
        color: var(--vscode-input-placeholderForeground);
    }

    .agent-card {
        margin: 8px 12px;
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 0;
        overflow: hidden;
    }
    .agent-header {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        background: var(--vscode-editor-background);
        cursor: pointer;
        user-select: none;
        gap: 8px;
    }
    .agent-header:hover {
        background: var(--vscode-list-hoverBackground);
    }
    .agent-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
    }
    .agent-name {
        flex: 1;
        font-weight: 600;
        font-size: 13px;
        display: flex;
        align-items: center;
    }
    .agent-badge {
        background: var(--vscode-notificationsWarningIcon-foreground);
        color: var(--vscode-editor-background);
        width: 18px;
        height: 18px;
        border-radius: 50%;
        font-size: 10px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-left: 6px;
    }
    .agent-stats {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
    }
    .chevron {
        font-size: 12px;
        transition: transform 0.15s ease;
        flex-shrink: 0;
    }
    .chevron.open {
        transform: rotate(90deg);
    }
    .agent-body {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.2s ease;
        background: var(--vscode-sideBar-background);
    }
    .agent-body.open {
        max-height: 2000px;
    }
    .agent-content {
        padding: 12px;
    }
    .section {
        margin-bottom: 16px;
    }
    .action-row {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
    }
    .action-row .action-btn {
        flex: 1;
        width: auto;
        justify-content: center;
    }
    .action-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 0;
        cursor: pointer;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        text-align: left;
        transition: background 0.15s ease;
    }
    .action-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }
    .action-btn.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    .action-btn.active:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .action-btn.warning {
        background: #d97706;
        color: white;
    }
    .action-btn.warning:hover {
        background: #f59e0b;
    }
    .action-btn.danger {
        background: var(--vscode-errorForeground);
        color: white;
    }
    .action-btn.danger:hover {
        opacity: 0.85;
    }
    .action-btn .icon {
        font-size: 14px;
    }
    .status-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        padding: 6px 8px;
        border-radius: 2px;
        margin-bottom: 8px;
    }
    .status-indicator.paused {
        background: rgba(217, 119, 6, 0.15);
        color: #f59e0b;
    }
    .status-indicator.disabled {
        background: rgba(239, 68, 68, 0.15);
        color: var(--vscode-errorForeground);
    }
    .alert {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px;
        background: var(--vscode-inputValidation-warningBackground);
        border: 1px solid var(--vscode-inputValidation-warningBorder);
        border-radius: 0;
        margin-bottom: 8px;
        font-size: 12px;
    }
    .alert .icon {
        color: var(--vscode-notificationsWarningIcon-foreground);
        font-size: 16px;
        flex-shrink: 0;
    }
    .alert-content {
        flex: 1;
    }
    .alert-title {
        font-weight: 600;
        margin-bottom: 4px;
    }
    .alert-action-btn {
        padding: 6px 12px;
        background: #d97706;
        color: white;
        border: none;
        border-radius: 0;
        cursor: pointer;
        font-size: 11px;
        font-family: var(--vscode-font-family);
        font-weight: 500;
        white-space: nowrap;
        flex-shrink: 0;
    }
    .alert-action-btn:hover {
        background: #f59e0b;
    }
    .info-line {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        padding: 6px 0;
    }
    .info-line .icon {
        font-size: 14px;
        opacity: 0.7;
    }
    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
    }
    .section-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--vscode-foreground);
    }
    .add-btn {
        padding: 3px 8px 2px 8px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 0;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.15s ease;
    }
    .add-btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .memory-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .memory-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 13px 8px;
        background: var(--vscode-editor-background);
        border: 0;
        border-radius: 0;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s ease;
    }
    .memory-item:hover {
        background: var(--vscode-list-hoverBackground);
    }
    .memory-item .icon {
        font-size: 14px;
        opacity: 0.7;
        flex-shrink: 0;
    }
    .memory-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .memory-date {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
    }
    .memory-actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
    }
    .mini-btn {
        padding: 4px;
        background: var(--vscode-sideBar-background);
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        border-radius: 2px;
        opacity: 0.5;
        transition: opacity 0.15s ease, background 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .memory-item:hover .mini-btn {
        opacity: 0.7;
    }
    .mini-btn:hover {
        opacity: 1 !important;
        background: var(--vscode-toolbar-hoverBackground);
    }
    .mini-btn.delete:hover {
        color: var(--vscode-errorForeground);
    }
    .memory-item.immediate {
        border-left: 2px solid var(--vscode-charts-purple, #b180d7);
        opacity: 0.85;
    }
    .memory-item.immediate .icon {
        color: var(--vscode-charts-purple, #b180d7);
        opacity: 1;
    }
    .memory-item.needs-input {
        border-left: 2px solid var(--vscode-notificationsWarningIcon-foreground);
    }
    .warning-icon {
        color: var(--vscode-notificationsWarningIcon-foreground) !important;
        opacity: 1 !important;
    }
    .empty {
        text-align: center;
        padding: 40px 20px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
    }
</style>
</head>
<body>
    <div class="search-container">
        <input 
            type="text" 
            class="search-input" 
            id="searchInput" 
            placeholder="Search memories..."
        />
    </div>
    <div id="agentList"></div>
<script>
    const vscode = acquireVsCodeApi();

    let agents = [];
    let expandedAgents = new Set();
    let searchQuery = '';

    // Restore state
    const state = vscode.getState();
    if (state?.expandedAgents) {
        expandedAgents = new Set(state.expandedAgents);
    }

    // Search input handler
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        render();
    });

    // Handle messages
    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'update') {
            agents = msg.agents;
            render();
        }
    });

    function render() {
        const container = document.getElementById('agentList');
        
        // Filter agents based on search query
        const filteredAgents = agents.map(agent => {
            if (!searchQuery) {
                return agent;
            }
            
            // Filter memories by title (or filename if no title)
            const filteredMemories = agent.memories.filter(mem => {
                const searchable = (mem.title || mem.filename).toLowerCase();
                return searchable.includes(searchQuery);
            });
            
            // Only include agent if it has matching memories or search is empty
            if (filteredMemories.length === 0) {
                return null;
            }
            
            return {
                ...agent,
                memories: filteredMemories,
                memoryCount: filteredMemories.length
            };
        }).filter(Boolean);
        
        if (filteredAgents.length === 0) {
            if (searchQuery) {
                container.innerHTML = '<div class=\"empty\">No memories found matching \"' + searchQuery + '\"</div>';
            } else {
                container.innerHTML = '<div class=\"empty\">No agents found. Create a .agent.md file in .github/agents/</div>';
            }
            return;
        }

        container.innerHTML = filteredAgents.map(agent => {
            const isExpanded = expandedAgents.has(agent.name);
            const stats = agent.stats 
                ? \`\${agent.stats.invocations} invocation\${agent.stats.invocations !== 1 ? 's' : ''}\`
                : '';
            const memInfo = agent.memoryCount > 0 
                ? \`\${agent.memoryCount} memor\${agent.memoryCount !== 1 ? 'ies' : 'y'}\`
                : 'no memories';

            return \`
<div class="agent-card">
    <div class="agent-header" onclick="toggleAgent('\${agent.name}')">
        <i data-lucide="\${agent.hasQuestions ? 'bell' : 'bot'}" class="agent-icon"></i>
        <span class="agent-name">\${agent.name}\${agent.hasQuestions ? ' <span class="agent-badge">!</span>' : ''}</span>
        <span class="agent-stats">\${[stats, memInfo].filter(Boolean).join(' · ')}</span>
        <i data-lucide="chevron-right" class="chevron \${isExpanded ? 'open' : ''}" style="width:14px;height:14px;"></i>
    </div>
    <div class="agent-body \${isExpanded ? 'open' : ''} id="body-\${agent.name}">
        <div class="agent-content">
            \${!agent.enabled ? \`
            <div class="status-indicator disabled">
                <i data-lucide="x-circle" style="width:14px;height:14px;"></i>
                <span>Memory disabled - all operations blocked</span>
            </div>
            \` : agent.paused ? \`
            <div class="status-indicator paused">
                <i data-lucide="pause-circle" style="width:14px;height:14px;"></i>
                <span>Memory paused - read-only mode</span>
            </div>
            \` : ''}

            <div class="section">
                <div class="action-row">
                    <button class="action-btn" onclick="openFile('\${agent.promptPath}')">
                        <i data-lucide="file-text" class="icon" style="width:14px;height:14px;"></i>
                        <span>Open</span>
                    </button>
                    <button class="action-btn \${agent.paused ? 'warning' : ''}" onclick="togglePause('\${agent.name}')" title="\${agent.paused ? 'Resume memory writes' : 'Pause memory writes'}">
                        <i data-lucide="\${agent.paused ? 'play' : 'pause'}" class="icon" style="width:14px;height:14px;"></i>
                        <span>\${agent.paused ? 'Resume' : 'Pause'}</span>
                    </button>
                    <button class="action-btn \${!agent.enabled ? 'danger' : ''}" onclick="toggleEnabled('\${agent.name}')" title="\${agent.enabled ? 'Disable all memory operations' : 'Enable memory operations'}">
                        <i data-lucide="\${agent.enabled ? 'power' : 'power-off'}" class="icon" style="width:14px;height:14px;"></i>
                        <span>\${agent.enabled ? 'Disable' : 'Enable'}</span>
                    </button>
                </div>
            </div>

            \${agent.hasQuestions ? \`
            <div class="section">
                \${agent.questionFiles.map(qf => \`
                <div class="alert">
                    <i data-lucide="alert-triangle" class="icon" style="width:16px;height:16px;"></i>
                    <div class="alert-content">
                        <div class="alert-title">Human input required</div>
                        <div>\${qf.title}</div>
                    </div>
                    <button class="alert-action-btn" onclick="openFile('\${qf.filepath}')">
                        Fix
                    </button>
                </div>
                \`).join('')}
            </div>
            \` : ''}

            \${agent.stats ? \`
            <div class="section">
                <div class="info-line">
                    <i data-lucide="clock" class="icon" style="width:14px;height:14px;"></i>
                    <span>Last invoked: \${formatTimestamp(agent.stats.lastInvocation)} · \${agent.stats.invocations} invocations</span>
                </div>
            </div>
            \` : ''}

            <div class="section">
                <div class="section-header">
                    <span class="section-title">Memories (\${agent.memoryCount} entries, \${formatBytes(agent.memoryBytes)})</span>
                    <button class="add-btn" onclick="newMemory('\${agent.name}')">+ New</button>
                </div>
                \${agent.memories.length > 0 ? \`
                <div class="memory-list">
                    <div class="memory-item immediate" onclick="openImmediateMemory('\${agent.name}')">
                        <i data-lucide="message-circle-more" class="icon" style="width:14px;height:14px;"></i>
                        <span class="memory-name">Immediate memory</span>
                        <span class="memory-date"></span>
                        <div class="memory-actions" onclick="event.stopPropagation()">
                            <button class="mini-btn" onclick="openImmediateMemory('\${agent.name}')" title="Edit">
                                <i data-lucide="pencil" style="width:13px;height:13px;"></i>
                            </button>
                        </div>
                    </div>
                    \${agent.memories.map(mem => \`
                    <div class="memory-item\${mem.needsHumanInput ? ' needs-input' : ''}" onclick="openFile('\${mem.filepath}')">
                        <i data-lucide="\${mem.needsHumanInput ? 'alert-circle' : 'file-text'}" class="icon\${mem.needsHumanInput ? ' warning-icon' : ''}" style="width:14px;height:14px;"></i>
                        <span class="memory-name">\${mem.title || mem.filename}</span>
                        <span class="memory-date">\${mem.modified}</span>
                        <div class="memory-actions" onclick="event.stopPropagation()">
                            <button class="mini-btn" onclick="openFile('\${mem.filepath}')" title="Edit">
                                <i data-lucide="pencil" style="width:13px;height:13px;"></i>
                            </button>
                            <button class="mini-btn delete" onclick="deleteMemory('\${mem.filepath}', '\${mem.filename}')" title="Delete">
                                <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
                            </button>
                        </div>
                    </div>
                    \`).join('')}
                </div>
                \` : \`
                <div class="memory-list">
                    <div class="memory-item immediate" onclick="openImmediateMemory('\${agent.name}')">
                        <i data-lucide="message-circle-more" class="icon" style="width:14px;height:14px;"></i>
                        <span class="memory-name">Immediate memory</span>
                        <span class="memory-date"></span>
                        <div class="memory-actions" onclick="event.stopPropagation()">
                            <button class="mini-btn" onclick="openImmediateMemory('\${agent.name}')" title="Edit">
                                <i data-lucide="pencil" style="width:13px;height:13px;"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="info-line">No other memories yet</div>
                \`}
            </div>
        </div>
    </div>
</div>
            \`;
        }).join('');
        
        // Initialize lucide icons after rendering
        setTimeout(() => lucide.createIcons(), 0);
    }

    function toggleAgent(name) {
        if (expandedAgents.has(name)) {
            expandedAgents.delete(name);
        } else {
            expandedAgents.add(name);
        }
        vscode.setState({ expandedAgents: Array.from(expandedAgents) });
        render();
    }

    function openFile(path) {
        vscode.postMessage({ type: 'openFile', path });
    }

    function openImmediateMemory(agentName) {
        vscode.postMessage({ type: 'openImmediateMemory', agentName });
    }

    function deleteMemory(path, filename) {
        vscode.postMessage({ type: 'deleteMemory', path, filename });
    }

    function newMemory(agentName) {
        vscode.postMessage({ type: 'newMemory', agentName });
    }

    function togglePause(agentName) {
        vscode.postMessage({ type: 'togglePause', agentName });
    }

    function toggleEnabled(agentName) {
        vscode.postMessage({ type: 'toggleEnabled', agentName });
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatTimestamp(iso) {
        try {
            const d = new Date(iso);
            const now = new Date();
            const diff = now.getTime() - d.getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            const hours = Math.floor(mins / 60);
            if (hours < 24) return hours + 'h ago';
            const days = Math.floor(hours / 24);
            if (days < 7) return days + 'd ago';
            return d.toLocaleDateString();
        } catch {
            return iso;
        }
    }

    // Tell extension we're ready
    vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
