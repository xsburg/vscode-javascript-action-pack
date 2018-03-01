import { ExtensionContext, commands, window, workspace, Range, QuickPickItem, Uri } from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import codeModService from './services/codeModService';

export async function runCodeModCommand() {
    if (!window.activeTextEditor) {
        return;
    }
    const document = window.activeTextEditor.document;
    if (
        ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].indexOf(
            document.languageId
        ) === -1
    ) {
        return;
    }

    const codeMods = await codeModService.loadAllCodeMods();
    const selectedMod = await window.showQuickPick(
        codeMods.map(mod => ({
            label: mod.name,
            description: mod.description,
            detail: mod.detail,
            mod
        }))
    );
    if (!selectedMod) {
        return;
    }

    let startPos = document.offsetAt(window.activeTextEditor.selection.start);
    let endPos = document.offsetAt(window.activeTextEditor.selection.end);
    if (startPos > endPos) {
        [startPos, endPos] = [endPos, startPos];
    }
    const source = document.getText();
    try {
        const result = codeModService.runCodeMod({
            mod: selectedMod.mod,
            fileName: document.fileName,
            source,
            selection: {
                startPos,
                endPos
            }
        });
    } catch (e) {
        window.showErrorMessage(`Error while running codemod: ${e.message}`);
        return;
    }
    try {
        result = selectedMod.mod.modFn(
            {
                path: document.fileName,
                source: text
            },
            {
                jscodeshift: j,
                stats: {}
            },
            {
                startPos,
                endPos
            }
        );
    } catch (e) {
        window.showErrorMessage(`Error while running codemod: ${e.message}`);
        return;
    }
    // handle the results
    if (result === null || result === undefined || result === text) {
        window.showInformationMessage('Nothing to change.');
        return;
    }
    const allTextRange = new Range(document.positionAt(0), document.positionAt(text.length - 1));
    window.activeTextEditor.edit(edit => {
        edit.replace(allTextRange, result);
    });
}