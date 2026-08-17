import * as vscode from 'vscode';

type StruggleLevel = 1 | 2 | 3;

interface Features {
  edits: number;
  deletions: number;
  rapidEdits: number;
  cursorReversals: number;
  diagnostics: number;
  idleSeconds: number;
}

class StruggleDetector {
  private features: Features = {
    edits: 0, deletions: 0, rapidEdits: 0,
    cursorReversals: 0, diagnostics: 0, idleSeconds: 0
  };
  private lastEditAt = 0;
  private lastCursorLine = -1;
  private manualLevel: StruggleLevel | undefined;

  recordChange(change: vscode.TextDocumentChangeEvent) {
    const now = Date.now();
    this.features.edits += change.contentChanges.length;
    for (const c of change.contentChanges) {
      if (c.rangeLength > c.text.length) this.features.deletions += c.rangeLength - c.text.length;
    }
    if (this.lastEditAt && now - this.lastEditAt < 900) this.features.rapidEdits++;
    this.lastEditAt = now;
  }

  recordCursor(position: vscode.Position) {
    if (this.lastCursorLine !== -1 && Math.abs(position.line - this.lastCursorLine) > 8) {
      this.features.cursorReversals++;
    }
    this.lastCursorLine = position.line;
  }

  setDiagnostics(count: number) { this.features.diagnostics = count; }
  setManual(level?: StruggleLevel) { this.manualLevel = level; }

  predict(idleSeconds: number): StruggleLevel {
    if (this.manualLevel) return this.manualLevel;
    this.features.idleSeconds = idleSeconds;

    // Transparent MVP heuristic. Replace with a trained classifier later.
    let score = 0;
    score += Math.min(this.features.rapidEdits, 8) * 0.7;
    score += Math.min(this.features.deletions, 40) * 0.05;
    score += Math.min(this.features.cursorReversals, 6) * 0.8;
    score += Math.min(this.features.diagnostics, 5) * 1.2;
    if (idleSeconds >= 45) score += 1.5;
    if (idleSeconds >= 90) score += 1.5;

    if (score >= 7) return 3;
    if (score >= 3) return 2;
    return 1;
  }

  reset() {
    this.features = { edits: 0, deletions: 0, rapidEdits: 0, cursorReversals: 0, diagnostics: 0, idleSeconds: 0 };
    this.lastEditAt = 0;
    this.lastCursorLine = -1;
    this.manualLevel = undefined;
  }
}

const hintForLevel: Record<StruggleLevel, string> = {
  1: 'Think about the invariant or the next small step. What should be true before and after this line?',
  2: 'Look closely at the failing operation and its inputs. Try tracing one concrete example by hand before changing the code.',
  3: 'You have reached the direct-help level. Ask the coding model for the corrected approach and implementation.'
};

export function activate(context: vscode.ExtensionContext) {
  const detector = new StruggleDetector();
  let lastActivity = Date.now();

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'codingBuddy.setStruggleLevel';
  status.text = '$(mortar-board) Buddy: L1';
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      if (!vscode.workspace.getConfiguration('codingBuddy').get('enabled', true)) return;
      detector.recordChange(e);
      lastActivity = Date.now();
    }),
    vscode.window.onDidChangeTextEditorSelection(e => {
      detector.recordCursor(e.selections[0].active);
      lastActivity = Date.now();
    }),
    vscode.languages.onDidChangeDiagnostics(() => {
      const editor = vscode.window.activeTextEditor;
      const count = editor ? vscode.languages.getDiagnostics(editor.document.uri).length : 0;
      detector.setDiagnostics(count);
    })
  );

  const timer = setInterval(() => {
    const idle = Math.floor((Date.now() - lastActivity) / 1000);
    const configuredIdle = vscode.workspace.getConfiguration('codingBuddy').get('idleSeconds', 45);
    const level = detector.predict(Math.min(idle, configuredIdle * 2));
    status.text = `$(mortar-board) Buddy: L${level}`;
    status.tooltip = `Estimated struggle level: ${level}. Click to override.`;
  }, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(vscode.commands.registerCommand('codingBuddy.hint', async () => {
    const idle = Math.floor((Date.now() - lastActivity) / 1000);
    const level = detector.predict(idle);
    await vscode.window.showInformationMessage(`Struggle L${level}: ${hintForLevel[level]}`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codingBuddy.setStruggleLevel', async () => {
    const picked = await vscode.window.showQuickPick([
      { label: 'Auto', description: 'Let Coding Buddy classify my struggle', value: undefined },
      { label: 'Level 1', description: 'Slight hints', value: 1 as StruggleLevel },
      { label: 'Level 2', description: 'Further hints', value: 2 as StruggleLevel },
      { label: 'Level 3', description: 'Direct answer', value: 3 as StruggleLevel }
    ], { placeHolder: 'Choose Coding Buddy struggle level' });
    if (!picked) return;
    detector.setManual(picked.value);
    status.text = `$(mortar-board) Buddy: ${picked.value ? `L${picked.value}` : 'Auto'}`;
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codingBuddy.reset', () => {
    detector.reset();
    lastActivity = Date.now();
    status.text = '$(mortar-board) Buddy: L1';
    vscode.window.showInformationMessage('Coding Buddy struggle detection reset.');
  }));
}

export function deactivate() {}
