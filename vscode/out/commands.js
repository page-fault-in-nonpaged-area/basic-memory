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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function registerCommands(context, treeProvider, workspaceRoot) {
    const agentsDir = path.join(workspaceRoot, '.github', 'agents');
    const memoryBaseDir = path.join(agentsDir, 'memory');
    // Refresh command
    context.subscriptions.push(vscode.commands.registerCommand('agent-memory.refresh', () => {
        treeProvider.refresh();
    }));
    // New memory command
    context.subscriptions.push(vscode.commands.registerCommand('agent-memory.newMemory', async (item) => {
        let agentName = item?.agentName;
        if (!agentName) {
            if (!fs.existsSync(agentsDir)) {
                vscode.window.showErrorMessage('No agents directory found');
                return;
            }
            const files = fs.readdirSync(agentsDir);
            const agents = files
                .filter(f => f.endsWith('.agent.md'))
                .map(f => f.replace('.agent.md', ''));
            if (agents.length === 0) {
                vscode.window.showInformationMessage('No agents found');
                return;
            }
            agentName = await vscode.window.showQuickPick(agents, {
                placeHolder: 'Select agent for new memory'
            });
            if (!agentName)
                return;
        }
        const title = await vscode.window.showInputBox({
            prompt: 'Memory title (will be used as filename)',
            placeHolder: 'e.g., project-setup'
        });
        if (!title)
            return;
        const filename = title.toLowerCase()
            .replace(/[^a-z0-9\-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        const memoryDir = path.join(memoryBaseDir, agentName);
        const memoryPath = path.join(memoryDir, `${filename}.md`);
        if (!fs.existsSync(memoryDir)) {
            fs.mkdirSync(memoryDir, { recursive: true });
        }
        if (fs.existsSync(memoryPath)) {
            const overwrite = await vscode.window.showWarningMessage(`Memory "${filename}" already exists. Overwrite?`, 'Yes', 'No');
            if (overwrite !== 'Yes')
                return;
        }
        const template = `# ${title}\n\n## Summary\n\n\n\n## Details\n\n\n`;
        fs.writeFileSync(memoryPath, template, 'utf-8');
        const doc = await vscode.workspace.openTextDocument(memoryPath);
        await vscode.window.showTextDocument(doc);
        treeProvider.refresh();
    }));
    // Edit memory — opens the file in the editor
    context.subscriptions.push(vscode.commands.registerCommand('agent-memory.editMemory', async (item) => {
        if (item.resourcePath) {
            const doc = await vscode.workspace.openTextDocument(item.resourcePath);
            await vscode.window.showTextDocument(doc);
        }
    }));
    // Delete memory — confirm then remove file
    context.subscriptions.push(vscode.commands.registerCommand('agent-memory.deleteMemory', async (item) => {
        if (!item.resourcePath)
            return;
        const confirm = await vscode.window.showWarningMessage(`Delete memory "${item.label}"?`, { modal: true }, 'Delete');
        if (confirm !== 'Delete')
            return;
        try {
            fs.unlinkSync(item.resourcePath);
            treeProvider.refresh();
            vscode.window.showInformationMessage(`Deleted: ${item.label}`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to delete: ${err}`);
        }
    }));
    // Open prompt command
    context.subscriptions.push(vscode.commands.registerCommand('agent-memory.openPrompt', async (item) => {
        if (item.resourcePath) {
            const doc = await vscode.workspace.openTextDocument(item.resourcePath);
            await vscode.window.showTextDocument(doc);
        }
    }));
    // Open memory folder in file explorer
    context.subscriptions.push(vscode.commands.registerCommand('agent-memory.openMemoryFolder', async (item) => {
        if (!item.agentName)
            return;
        const memoryDir = path.join(memoryBaseDir, item.agentName);
        if (!fs.existsSync(memoryDir)) {
            const create = await vscode.window.showInformationMessage(`Memory folder for "${item.agentName}" doesn't exist. Create it?`, 'Yes', 'No');
            if (create === 'Yes') {
                fs.mkdirSync(memoryDir, { recursive: true });
                treeProvider.refresh();
            }
            return;
        }
        const uri = vscode.Uri.file(memoryDir);
        await vscode.commands.executeCommand('revealInExplorer', uri);
    }));
}
//# sourceMappingURL=commands.js.map