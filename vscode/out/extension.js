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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const agentListView_1 = require("./agentListView");
const bmSetupView_1 = require("./bmSetupView");
function activate(context) {
    console.log('Basic Memory Control Panel activated');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Basic Memory: No workspace folder open');
        return;
    }
    // --- Basic Memory Controls (install / start / status) ---
    const setupProvider = new bmSetupView_1.BmSetupViewProvider(context.extensionUri, workspaceRoot);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(bmSetupView_1.BmSetupViewProvider.viewType, setupProvider));
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('bm-controls.installBasicMemory', () => setupProvider.installBasicMemory()), vscode.commands.registerCommand('bm-controls.startBasicMemory', () => setupProvider.startBasicMemory()), vscode.commands.registerCommand('bm-controls.stopBasicMemory', () => setupProvider.stopBasicMemory()), vscode.commands.registerCommand('bm-controls.checkStatus', () => setupProvider.checkStatus()), vscode.commands.registerCommand('bm-controls.syncDatabase', () => setupProvider.syncDatabase()));
    // --- Agent List ---
    const agentListProvider = new agentListView_1.AgentListViewProvider(context.extensionUri, workspaceRoot);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(agentListView_1.AgentListViewProvider.viewType, agentListProvider));
}
function deactivate() {
    console.log('Basic Memory Control Panel deactivated');
}
//# sourceMappingURL=extension.js.map