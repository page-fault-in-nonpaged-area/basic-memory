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
exports.AgentTreeDataProvider = exports.AgentTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class AgentTreeItem extends vscode.TreeItem {
    label;
    collapsibleState;
    itemType;
    agentName;
    resourcePath;
    constructor(label, collapsibleState, itemType, agentName, resourcePath) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.itemType = itemType;
        this.agentName = agentName;
        this.resourcePath = resourcePath;
        this.contextValue = itemType;
    }
}
exports.AgentTreeItem = AgentTreeItem;
class AgentTreeDataProvider {
    workspaceRoot;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    agentsDir;
    memoryBaseDir;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.agentsDir = path.join(workspaceRoot, '.github', 'agents');
        this.memoryBaseDir = path.join(this.agentsDir, 'memory');
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            return this.getAgents();
        }
        if (element.itemType === 'agent' && element.agentName) {
            return this.getAgentChildren(element.agentName);
        }
        if (element.itemType === 'memoryFolder' && element.agentName) {
            return this.getMemoryFiles(element.agentName);
        }
        return [];
    }
    // ── Root: list agents ──────────────────────────────────────────────
    async getAgents() {
        if (!fs.existsSync(this.agentsDir)) {
            return [];
        }
        try {
            const files = await fs.promises.readdir(this.agentsDir);
            const agents = [];
            for (const file of files) {
                if (!file.endsWith('.agent.md'))
                    continue;
                const agentName = file.replace('.agent.md', '');
                const hasQuestions = this.getQuestionFiles(agentName).length > 0;
                const label = hasQuestions ? `${agentName} (!)` : agentName;
                const item = new AgentTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, 'agent', agentName);
                item.iconPath = new vscode.ThemeIcon(hasQuestions ? 'bell-dot' : 'hubot');
                // Description: quick stats summary
                const stats = this.getAgentStats(agentName);
                const memInfo = this.getMemoryInfo(agentName);
                const parts = [];
                if (stats) {
                    parts.push(`${stats.invocations} invocations`);
                }
                if (memInfo.count > 0) {
                    parts.push(`${memInfo.count} memories`);
                }
                if (parts.length > 0) {
                    item.description = parts.join(' · ');
                }
                agents.push(item);
            }
            return agents.sort((a, b) => a.label.localeCompare(b.label));
        }
        catch {
            return [];
        }
    }
    // ── Agent children ─────────────────────────────────────────────────
    getAgentChildren(agentName) {
        const children = [];
        // 1. Open agent.md button
        const promptPath = path.join(this.agentsDir, `${agentName}.agent.md`);
        if (fs.existsSync(promptPath)) {
            const item = new AgentTreeItem('Open agent.md', vscode.TreeItemCollapsibleState.None, 'openPrompt', agentName, promptPath);
            item.iconPath = new vscode.ThemeIcon('file-text');
            item.command = {
                command: 'vscode.open',
                title: 'Open Prompt',
                arguments: [vscode.Uri.file(promptPath)]
            };
            children.push(item);
        }
        // 2. Questions alert (conditional)
        const questionFiles = this.getQuestionFiles(agentName);
        if (questionFiles.length > 0) {
            for (const qf of questionFiles) {
                const item = new AgentTreeItem(`Agent has questions in ${qf.filename}`, vscode.TreeItemCollapsibleState.None, 'questionsAlert', agentName, qf.filepath);
                item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground'));
                children.push(item);
            }
            // Address Questions button
            const addressItem = new AgentTreeItem('Address questions', vscode.TreeItemCollapsibleState.None, 'addressQuestions', agentName, questionFiles[0].filepath);
            addressItem.iconPath = new vscode.ThemeIcon('comment-discussion');
            addressItem.command = {
                command: 'vscode.open',
                title: 'Address Questions',
                arguments: [vscode.Uri.file(questionFiles[0].filepath)]
            };
            children.push(addressItem);
        }
        // 3. Stats info line
        const stats = this.getAgentStats(agentName);
        if (stats) {
            const lastInvoked = this.formatTimestamp(stats.lastInvocation);
            const item = new AgentTreeItem(`last invoked: ${lastInvoked}`, vscode.TreeItemCollapsibleState.None, 'statsInfo', agentName);
            item.iconPath = new vscode.ThemeIcon('history');
            item.description = `invocations: ${stats.invocations}`;
            children.push(item);
        }
        // 4. Memory folder
        const memInfo = this.getMemoryInfo(agentName);
        const memoryDir = path.join(this.memoryBaseDir, agentName);
        if (fs.existsSync(memoryDir)) {
            const item = new AgentTreeItem(`Memories (${memInfo.count} entries, ${this.formatBytes(memInfo.totalBytes)})`, memInfo.count > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None, 'memoryFolder', agentName, memoryDir);
            item.iconPath = new vscode.ThemeIcon('folder-library');
            children.push(item);
        }
        return children;
    }
    // ── Memory files ───────────────────────────────────────────────────
    async getMemoryFiles(agentName) {
        const memoryDir = path.join(this.memoryBaseDir, agentName);
        if (!fs.existsSync(memoryDir))
            return [];
        try {
            const files = await fs.promises.readdir(memoryDir);
            const memories = [];
            for (const file of files) {
                if (!file.endsWith('.md') || file.startsWith('.'))
                    continue;
                const filePath = path.join(memoryDir, file);
                const stat = await fs.promises.stat(filePath);
                const item = new AgentTreeItem(file, vscode.TreeItemCollapsibleState.None, 'memory', agentName, filePath);
                item.iconPath = new vscode.ThemeIcon('note');
                item.description = this.formatDate(stat.mtime);
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Memory',
                    arguments: [vscode.Uri.file(filePath)]
                };
                memories.push(item);
            }
            return memories.sort((a, b) => a.label.localeCompare(b.label));
        }
        catch {
            return [];
        }
    }
    // ── Data helpers ───────────────────────────────────────────────────
    getAgentStats(agentName) {
        const statsPath = path.join(this.memoryBaseDir, agentName, '.stats.json');
        if (!fs.existsSync(statsPath))
            return null;
        try {
            const content = fs.readFileSync(statsPath, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    getMemoryInfo(agentName) {
        const memoryDir = path.join(this.memoryBaseDir, agentName);
        if (!fs.existsSync(memoryDir))
            return { count: 0, totalBytes: 0 };
        try {
            const files = fs.readdirSync(memoryDir);
            let count = 0;
            let totalBytes = 0;
            for (const file of files) {
                if (file.endsWith('.md') && !file.startsWith('.')) {
                    count++;
                    const stat = fs.statSync(path.join(memoryDir, file));
                    totalBytes += stat.size;
                }
            }
            return { count, totalBytes };
        }
        catch {
            return { count: 0, totalBytes: 0 };
        }
    }
    /** Questions files follow the pattern: questions-*.md or *.questions.md */
    getQuestionFiles(agentName) {
        const memoryDir = path.join(this.memoryBaseDir, agentName);
        if (!fs.existsSync(memoryDir))
            return [];
        try {
            const files = fs.readdirSync(memoryDir);
            const questions = [];
            for (const file of files) {
                if (file.startsWith('.'))
                    continue;
                if (file.startsWith('questions-') || file.endsWith('.questions.md')) {
                    questions.push({
                        filename: file,
                        filepath: path.join(memoryDir, file)
                    });
                }
            }
            return questions;
        }
        catch {
            return [];
        }
    }
    // ── Formatters ─────────────────────────────────────────────────────
    formatBytes(bytes) {
        if (bytes < 1024)
            return `${bytes} B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    formatDate(date) {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0)
            return 'today';
        if (days === 1)
            return 'yesterday';
        if (days < 7)
            return `${days}d ago`;
        return date.toLocaleDateString();
    }
    formatTimestamp(iso) {
        try {
            const d = new Date(iso);
            const now = new Date();
            const diff = now.getTime() - d.getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 1)
                return 'just now';
            if (mins < 60)
                return `${mins}m ago`;
            const hours = Math.floor(mins / 60);
            if (hours < 24)
                return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            if (days < 7)
                return `${days}d ago`;
            return d.toLocaleDateString();
        }
        catch {
            return iso;
        }
    }
}
exports.AgentTreeDataProvider = AgentTreeDataProvider;
//# sourceMappingURL=agentTree.js.map