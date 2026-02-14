import * as vscode from 'vscode';
import { AgentLoaderViewProvider } from './agentLoader';
import { AgentListViewProvider } from './agentListView';
import { BmSetupViewProvider } from './bmSetupView';

export function activate(context: vscode.ExtensionContext) {
    console.log('Basic Memory Control Panel activated');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Basic Memory: No workspace folder open');
        return;
    }

    // --- Basic Memory Controls (install / start / status) ---
    const setupProvider = new BmSetupViewProvider(
        context.extensionUri,
        workspaceRoot
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            BmSetupViewProvider.viewType,
            setupProvider
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('bm-controls.installBasicMemory', () =>
            setupProvider.installBasicMemory()
        ),
        vscode.commands.registerCommand('bm-controls.startBasicMemory', () =>
            setupProvider.startBasicMemory()
        ),
        vscode.commands.registerCommand('bm-controls.stopBasicMemory', () =>
            setupProvider.stopBasicMemory()
        ),
        vscode.commands.registerCommand('bm-controls.checkStatus', () =>
            setupProvider.checkStatus()
        ),
        vscode.commands.registerCommand('bm-controls.syncDatabase', () =>
            setupProvider.syncDatabase()
        )
    );

    // --- Agent List ---
    const agentListProvider = new AgentListViewProvider(
        context.extensionUri,
        workspaceRoot
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            AgentListViewProvider.viewType,
            agentListProvider
        )
    );

    // --- Agent Loader ---
    const loaderProvider = new AgentLoaderViewProvider(
        context.extensionUri,
        workspaceRoot,
        context.secrets,
        agentListProvider
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            AgentLoaderViewProvider.viewType,
            loaderProvider
        )
    );
}

export function deactivate() {
    console.log('Basic Memory Control Panel deactivated');
}
