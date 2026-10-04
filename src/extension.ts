import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";

import { StruggleDetector } from "./struggleDetector";
import { HintEngine } from "./hintEngine";
import { SessionRecorder } from "./sessionRecorder";

let detector: StruggleDetector;
let hintEngine: HintEngine;
let sessionRecorder: SessionRecorder;
let statusBar: vscode.StatusBarItem;

let currentLevel = 1;
let manualOverride = false;
let manualLevel = 1;
let levelStartedAt = Date.now();
let automaticTimer: NodeJS.Timeout;

// Prevent automatic level changes while generating a hint.
let isGeneratingHint = false;

export function activate(context: vscode.ExtensionContext) {
    console.log("AI Coding Buddy is now active.");

    detector = new StruggleDetector();
    hintEngine = new HintEngine();
    sessionRecorder = new SessionRecorder(context.globalStorageUri.fsPath);

    // STATUS BAR
    statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );

    statusBar.command = "codingBuddy.openControlPanel";
    updateStatusBar();
    statusBar.show();
    context.subscriptions.push(statusBar);

    // TRACK CODE EDITS
    const changeListener =
        vscode.workspace.onDidChangeTextDocument((event) => {
            let deletedCharacters = 0;

            for (const change of event.contentChanges) {
                if (change.rangeLength > change.text.length) {
                    deletedCharacters +=
                        change.rangeLength - change.text.length;
                }
            }

            detector.recordEdit(deletedCharacters);
        });

    context.subscriptions.push(changeListener);

    // TRACK ERRORS
    const diagnosticListener =
        vscode.languages.onDidChangeDiagnostics((event) => {
            for (const uri of event.uris) {
                const diagnostics =
                    vscode.languages.getDiagnostics(uri);

                for (const diagnostic of diagnostics) {
                    if (
                        diagnostic.severity ===
                        vscode.DiagnosticSeverity.Error
                    ) {
                        const errorKey =
                            `${uri.toString()}|` +
                            `${diagnostic.range.start.line}|` +
                            `${diagnostic.range.start.character}|` +
                            diagnostic.message;

                        detector.recordError(errorKey);
                    }
                }
            }
        });

    context.subscriptions.push(diagnosticListener);

    // CONTROL PANEL
    const controlPanelCommand =
        vscode.commands.registerCommand(
            "codingBuddy.openControlPanel",
            () => openControlPanel()
        );

    context.subscriptions.push(controlPanelCommand);

    // GET HINT
    const hintCommand = vscode.commands.registerCommand(
        "codingBuddy.getHint",
        async () => {
            if (isGeneratingHint) {
                vscode.window.showInformationMessage(
                    "AI Coding Buddy is already generating a hint. Please wait."
                );
                return;
            }

            const editor = vscode.window.activeTextEditor;

            if (!editor) {
                vscode.window.showWarningMessage(
                    "Open a code file first."
                );
                return;
            }

            // Capture the level and code when the user clicks.
            // These values will not change during generation.
            const levelAtRequest = getEffectiveLevel();
            const codeAtRequest = editor.document.getText();
            const languageAtRequest = editor.document.languageId;
            sessionRecorder.recordHint(levelAtRequest);

            isGeneratingHint = true;
            updateStatusBar();

            try {
                const hint = await vscode.window.withProgress(
                    {
                        location:
                            vscode.ProgressLocation.Notification,
                        title:
                            `AI Coding Buddy: Generating Level ${levelAtRequest} hint...`,
                        cancellable: false
                    },
                    async () => {
                        return await hintEngine.generateHint(
                            levelAtRequest,
                            codeAtRequest,
                            languageAtRequest
                        );
                    }
                );

                const panel = vscode.window.createWebviewPanel(
                    "codingBuddyHint",
                    `AI Coding Buddy - Level ${levelAtRequest}`,
                    vscode.ViewColumn.Beside,
                    {}
                );

                panel.webview.html = createHintHTML(
                    levelAtRequest,
                    hint
                );
            } catch (error) {
                console.error("Hint generation failed:", error);

                const message = error instanceof Error
                    ? error.message
                    : String(error);

                vscode.window.showErrorMessage(
                    `AI Coding Buddy could not generate a hint: ${message}`
                );
            } finally {
                isGeneratingHint = false;
                updateStatusBar();
            }
        }
    );

    context.subscriptions.push(hintCommand);

    // GET STRUGGLE LEVEL
    const levelCommand = vscode.commands.registerCommand(
        "codingBuddy.getLevel",
        async () => {
            if (!manualOverride && !isGeneratingHint) {
                const predictedLevel =
                    await detector.predictLevel();

                await processAutomaticLevel(predictedLevel);
            }

            updateStatusBar();

            const features = detector.getFeatures();

            const featureMessage = [
                "AI Coding Buddy",
                "",
                `Current Struggle Level: ${getEffectiveLevel()}`,
                "",
                `Idle Time: ${features.idle_seconds} seconds`,
                `Errors: ${features.errors}`,
                `Failed Runs: ${features.failed_runs}`,
                `Deletions: ${features.deletions}`,
                `Rapid Edits: ${features.rapid_edits}`
            ].join("\n");

            vscode.window.showInformationMessage(
                featureMessage,
                { modal: true }
            );
        }
    );

    context.subscriptions.push(levelCommand);

    // SET MANUAL LEVEL
    const setLevelCommand = vscode.commands.registerCommand(
        "codingBuddy.setLevel",
        async () => {
            const selection = await vscode.window.showQuickPick(
                [
                    {
                        label: "Level 1",
                        description: "Conceptual hint — let me think",
                        value: 1
                    },
                    {
                        label: "Level 2",
                        description: "Stronger hint / pseudocode",
                        value: 2
                    },
                    {
                        label: "Level 3",
                        description: "Direct explanation / solution",
                        value: 3
                    }
                ],
                {
                    placeHolder: "Choose the assistance level"
                }
            );

            if (!selection) {
                return;
            }

            setManualLevel(selection.value);
        }
    );

    context.subscriptions.push(setLevelCommand);

    // RETURN TO AUTOMATIC MODE
    const automaticCommand = vscode.commands.registerCommand(
        "codingBuddy.enableAutomatic",
        () => {
            enableAutomaticMode();

            vscode.window.showInformationMessage(
                "AI Coding Buddy is now using automatic detection."
            );
        }
    );

    context.subscriptions.push(automaticCommand);

    // PRIVACY-PRESERVING LEARNING SESSION
    const startSessionCommand = vscode.commands.registerCommand(
        "codingBuddy.startLearningSession",
        async () => {
            if (sessionRecorder.isActive) {
                vscode.window.showInformationMessage(
                    "A learning session is already active. Finish it before starting another."
                );
                return;
            }

            const choice = await vscode.window.showWarningMessage(
                "Start a learning session? AI Coding Buddy will keep behavior counts and your feedback locally. It will not save source code or upload data. An unfinished session is discarded when VS Code closes.",
                { modal: true },
                "Start Session"
            );
            if (choice !== "Start Session") {
                return;
            }

            detector.reset();
            sessionRecorder.start(getEffectiveLevel());
            vscode.window.showInformationMessage(
                "Learning session started. Use ‘AI Coding Buddy: Finish Learning Session’ when you are done."
            );
        }
    );
    context.subscriptions.push(startSessionCommand);

    const finishSessionCommand = vscode.commands.registerCommand(
        "codingBuddy.finishLearningSession",
        async () => {
            if (!sessionRecorder.isActive) {
                vscode.window.showInformationMessage(
                    "There is no active learning session."
                );
                return;
            }

            const outcome = await vscode.window.showQuickPick(
                [
                    { label: "Solved", description: "I reached a working solution", solved: true },
                    { label: "Still working", description: "I have not solved it yet", solved: false }
                ],
                { placeHolder: "How did the session go?" }
            );
            if (!outcome) {
                return;
            }

            try {
                await sessionRecorder.finish(outcome.solved, detector.getFeatures());
                vscode.window.showInformationMessage(
                    "Learning session saved locally. No source code was recorded."
                );
                detector.reset();
            } catch (error) {
                console.error("Could not save learning session:", error);
                vscode.window.showErrorMessage(
                    "AI Coding Buddy could not save the learning session."
                );
            }
        }
    );
    context.subscriptions.push(finishSessionCommand);

    // RUN PYTHON
    const runPythonCommand = vscode.commands.registerCommand(
        "codingBuddy.runPython",
        async () => {
            const editor = vscode.window.activeTextEditor;

            if (!editor) {
                vscode.window.showWarningMessage(
                    "Open a Python file first."
                );
                return;
            }

            if (editor.document.languageId !== "python") {
                vscode.window.showWarningMessage(
                    "The active file is not a Python file."
                );
                return;
            }

            const filePath = editor.document.fileName;
            sessionRecorder.recordAttempt();

            vscode.window.showInformationMessage(
                "AI Coding Buddy: Running Python file..."
            );

            const python = spawn("py", [filePath], {
                cwd: path.dirname(filePath)
            });

            python.stdout.on("data", (data: Buffer) => {
                console.log(data.toString());
            });

            python.stderr.on("data", (data: Buffer) => {
                console.error(data.toString());
            });

            python.on("error", (error) => {
                console.error("Python execution error:", error);

                detector.recordFailedRun();

                const features = detector.getFeatures();

                vscode.window.showErrorMessage(
                    `Python failed to start. Failed runs detected: ${features.failed_runs}`
                );
            });

            python.on("close", async (exitCode) => {
                if (exitCode !== 0) {
                    detector.recordFailedRun();

                    const features = detector.getFeatures();

                    vscode.window.showErrorMessage(
                        `Python run failed. Failed runs detected: ${features.failed_runs}`
                    );
                } else {
                    vscode.window.showInformationMessage(
                        "Python run completed successfully."
                    );
                }

                if (!manualOverride && !isGeneratingHint) {
                    const predictedLevel =
                        await detector.predictLevel();

                    await processAutomaticLevel(predictedLevel);
                }

                updateStatusBar();

                console.log(
                    "Current behavior features:",
                    detector.getFeatures()
                );

                console.log(
                    "Current struggle level:",
                    getEffectiveLevel()
                );
            });
        }
    );

    context.subscriptions.push(runPythonCommand);

    // RESET
    const resetCommand = vscode.commands.registerCommand(
        "codingBuddy.reset",
        () => {
            detector.reset();
            manualOverride = false;
            currentLevel = 1;
            levelStartedAt = Date.now();

            updateStatusBar();

            vscode.window.showInformationMessage(
                "AI Coding Buddy has been reset to automatic Level 1."
            );
        }
    );

    context.subscriptions.push(resetCommand);

    // AUTOMATIC LEVEL CHECK
    automaticTimer = setInterval(async () => {
        if (manualOverride || isGeneratingHint) {
            return;
        }

        try {
            const predictedLevel =
                await detector.predictLevel();

            await processAutomaticLevel(predictedLevel);
            updateStatusBar();
        } catch (error) {
            console.error(
                "Automatic level detection error:",
                error
            );
        }
    }, 5000);

    context.subscriptions.push({
        dispose: () => clearInterval(automaticTimer)
    });

    context.subscriptions.push({
        dispose: () => detector.dispose()
    });
}

// CONTROL PANEL
function openControlPanel(): void {
    const panel = vscode.window.createWebviewPanel(
        "codingBuddyControlPanel",
        "AI Coding Buddy",
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );

    panel.webview.html = createControlPanelHTML();

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "setLevel":
                setManualLevel(message.level);
                break;

            case "automatic":
                enableAutomaticMode();
                break;

            case "reset":
                detector.reset();
                manualOverride = false;
                currentLevel = 1;
                levelStartedAt = Date.now();
                updateStatusBar();
                break;

            case "getHint":
                await vscode.commands.executeCommand(
                    "codingBuddy.getHint"
                );
                break;
        }

        panel.webview.html = createControlPanelHTML();
    });
}

// MANUAL LEVEL
function setManualLevel(level: number): void {
    manualOverride = true;
    manualLevel = level;
    sessionRecorder.recordManualLevel(level);
    currentLevel = level;
    levelStartedAt = Date.now();

    updateStatusBar();

    vscode.window.showInformationMessage(
        `Manual override: Level ${level}`
    );
}

// AUTOMATIC MODE
function enableAutomaticMode(): void {
    manualOverride = false;
    currentLevel = 1;
    levelStartedAt = Date.now();

    updateStatusBar();
}

// EFFECTIVE LEVEL
function getEffectiveLevel(): number {
    return manualOverride ? manualLevel : currentLevel;
}

// AUTOMATIC LEVEL PROCESSING
async function processAutomaticLevel(
    predictedLevel: number
): Promise<number> {
    // Do not change the level while a hint is being generated.
    if (isGeneratingHint) {
        return currentLevel;
    }

    if (predictedLevel < currentLevel) {
        currentLevel = predictedLevel;
        levelStartedAt = Date.now();
        return currentLevel;
    }

    if (predictedLevel === currentLevel) {
        return currentLevel;
    }

    const elapsedSeconds = Math.floor(
        (Date.now() - levelStartedAt) / 1000
    );

    const waitTime = getLevelTimeLimit(currentLevel);

    if (elapsedSeconds < waitTime) {
        return currentLevel;
    }

    currentLevel = Math.min(currentLevel + 1, 3);
    levelStartedAt = Date.now();

    vscode.window.showInformationMessage(
        `AI Coding Buddy increased assistance to Level ${currentLevel}.`
    );

    return currentLevel;
}

// TIME LIMITS
function getLevelTimeLimit(level: number): number {
    const config =
        vscode.workspace.getConfiguration("codingBuddy");

    if (level === 1) {
        return config.get<number>("level1TimeLimit", 10);
    }

    if (level === 2) {
        return config.get<number>("level2TimeLimit", 30);
    }

    return config.get<number>("level3TimeLimit", 60);
}

// STATUS BAR
function updateStatusBar(): void {
    if (!statusBar) {
        return;
    }

    const level = getEffectiveLevel();
    const mode = manualOverride ? "Manual" : "Auto";

    statusBar.text =
        `$(lightbulb) AI Buddy: L${level} • ${mode}`;

    statusBar.tooltip =
        "Open AI Coding Buddy Control Panel";
}

// CONTROL PANEL HTML
function createControlPanelHTML(): string {
    const level = getEffectiveLevel();
    const mode = manualOverride ? "Manual" : "Automatic";

    const level1Time = getLevelTimeLimit(1);
    const level2Time = getLevelTimeLimit(2);
    const level3Time = getLevelTimeLimit(3);

    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 25px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
}
h1 {
    font-size: 26px;
    margin-bottom: 5px;
}
.subtitle {
    opacity: 0.7;
    margin-bottom: 25px;
}
.card {
    padding: 18px;
    margin-bottom: 18px;
    border-radius: 10px;
    background: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-panel-border);
}
.level {
    font-size: 32px;
    font-weight: bold;
    margin-top: 8px;
}
.mode {
    font-size: 16px;
    margin-top: 5px;
}
.buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 15px;
}
button {
    border: none;
    border-radius: 6px;
    padding: 10px 15px;
    cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}
button:hover {
    background: var(--vscode-button-hoverBackground);
}
.active {
    outline: 2px solid var(--vscode-focusBorder);
}
.time-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
}
.time-row:last-child {
    border-bottom: none;
}
.hint-button {
    width: 100%;
    margin-top: 10px;
    font-size: 16px;
}
</style>
</head>
<body>
<h1>🤖 AI Coding Buddy</h1>
<div class="subtitle">Your adaptive programming tutor</div>

<div class="card">
    <div>Current Assistance Level</div>
    <div class="level">Level ${level}</div>
    <div class="mode">Mode: <strong>${mode}</strong></div>
</div>

<div class="card">
    <strong>Assistance Level</strong>
    <div class="buttons">
        <button
            class="${level === 1 && manualOverride ? "active" : ""}"
            onclick="setLevel(1)">
            Level 1<br><small>Let me think</small>
        </button>

        <button
            class="${level === 2 && manualOverride ? "active" : ""}"
            onclick="setLevel(2)">
            Level 2<br><small>Stronger hint</small>
        </button>

        <button
            class="${level === 3 && manualOverride ? "active" : ""}"
            onclick="setLevel(3)">
            Level 3<br><small>Direct help</small>
        </button>
    </div>

    <button
        class="${!manualOverride ? "active" : ""}"
        style="margin-top:15px;"
        onclick="automatic()">
        🔄 Return to Automatic Detection
    </button>
</div>

<div class="card">
    <strong>Configured Time Limits</strong>

    <div class="time-row">
        <span>Level 1</span>
        <span>${level1Time} seconds</span>
    </div>

    <div class="time-row">
        <span>Level 2</span>
        <span>${level2Time} seconds</span>
    </div>

    <div class="time-row">
        <span>Level 3</span>
        <span>${level3Time} seconds</span>
    </div>

    <p style="opacity:0.7;">
        Change these values in VS Code Settings → AI Coding Buddy.
    </p>
</div>

<div class="card">
    <strong>Actions</strong>

    <button class="hint-button" onclick="getHint()">
        💡 Get Hint
    </button>

    <button class="hint-button" onclick="resetBuddy()">
        🔄 Reset AI Coding Buddy
    </button>
</div>

<script>
const vscode = acquireVsCodeApi();

function setLevel(level) {
    vscode.postMessage({
        command: "setLevel",
        level: level
    });
}

function automatic() {
    vscode.postMessage({
        command: "automatic"
    });
}

function resetBuddy() {
    vscode.postMessage({
        command: "reset"
    });
}

function getHint() {
    vscode.postMessage({
        command: "getHint"
    });
}
</script>
</body>
</html>
`;
}

// HINT HTML
function createHintHTML(level: number, hint: string): string {
    const escapedHint = hint
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");

    return `
<!DOCTYPE html>
<html>
<head>
<style>
body {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 20px;
}
h1 {
    font-size: 22px;
}
.hint {
    font-size: 16px;
    line-height: 1.6;
    padding: 15px;
    border-radius: 8px;
    background: var(--vscode-textBlockQuote-background);
}
</style>
</head>
<body>
<h1>💡 AI Coding Buddy</h1>

<p>
    Assistance level:
    <strong>Level ${level}</strong>
</p>

<div class="hint">
    ${escapedHint}
</div>
</body>
</html>
`;
}

export function deactivate() {
    if (automaticTimer) {
        clearInterval(automaticTimer);
    }

    if (detector) {
        detector.dispose();
    }
}
