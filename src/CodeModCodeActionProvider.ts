import * as vscode from 'vscode';
import codeModService from './services/codeModService';
import { commandIds } from './const';

export class CodeModCodeActionProvider implements vscode.CodeActionProvider {
    public async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Command[]> {
        if (
            ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].indexOf(
                document.languageId
            ) === -1
        ) {
            return;
        }

        const source = document.getText();
        const codeMods = await codeModService.getCodeActionMods({
            fileName: document.fileName,
            source,
            selection: {
                startPos: range.start,
                endPos: range.end
            }
        });
        return codeMods.map(
            mod =>
                ({
                    title: mod.name,
                    tooltip: mod.detail || mod.description,
                    command: commandIds.runCodeMod,
                    arguments: [mod]
                } as vscode.Command)
        );
    }
}