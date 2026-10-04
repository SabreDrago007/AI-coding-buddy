import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { StruggleDetector } from "./struggleDetector";
import { HintEngine } from "./hintEngine";
import { SessionRecorder } from "./sessionRecorder";
import { CodingLanguage, languageFromDocument, LanguageRunner } from "./languageRunner";

let detector: StruggleDetector;
let hintEngine: HintEngine;
let sessionRecorder: SessionRecorder;
let languageRunner: LanguageRunner;
let statusBar: vscode.StatusBarItem;
let runOutput: vscode.OutputChannel;
let controlPanel: vscode.WebviewPanel | undefined;
let selectedLanguage = "auto";

let currentLevel = 1;
let manualOverride = false;
let manualLevel = 1;
let levelStartedAt = Date.now();
let automaticTimer: NodeJS.Timeout;

// Prevent automatic level changes while generating a hint.
let isGeneratingHint = false;
let isStartingLearningSession = false;
let isRunningFile = false;

export function activate(context: vscode.ExtensionContext) {
    console.log("AI Coding Buddy is now active.");

    detector = new StruggleDetector();
    hintEngine = new HintEngine();
    sessionRecorder = new SessionRecorder(context.globalStorageUri.fsPath);
    languageRunner = new LanguageRunner();
    const storedLanguage = context.globalState.get<string>("selectedLanguage", "auto");
    selectedLanguage = ["auto", "python", "java", "c", "cpp"].includes(storedLanguage)
        ? storedLanguage
        : "auto";

    // STATUS BAR
    statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );

    statusBar.command = "codingBuddy.openControlPanel";
    updateStatusBar();
    statusBar.show();
    context.subscriptions.push(statusBar);
    runOutput = vscode.window.createOutputChannel("AI Coding Buddy");
    context.subscriptions.push(runOutput);

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
            () => openControlPanel(context)
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
            const codeAtRequest = editor.selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(editor.selection);
            const languageAtRequest = selectedLanguage === "auto"
                ? editor.document.languageId
                : selectedLanguage;
            let endpoint: URL;
            try {
                endpoint = hintEngine.getConfiguredEndpoint();
            } catch (error) {
                vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                return;
            }
            if (!hintEngine.isLocalEndpoint(endpoint)) {
                const approval = await vscode.window.showWarningMessage(
                    `This hint will send ${codeAtRequest.length} characters of source text to ${endpoint.host} over HTTPS. Continue?`,
                    { modal: true },
                    "Send Source and Continue"
                );
                if (approval !== "Send Source and Continue") {
                    return;
                }
            }
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
                            languageAtRequest,
                            endpoint
                        );
                    }
                );

                const panel = vscode.window.createWebviewPanel(
                    "codingBuddyHint",
                    `AI Coding Buddy - Level ${levelAtRequest}`,
                    vscode.ViewColumn.Beside,
                    { enableScripts: false, localResourceRoots: [] }
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
            if (sessionRecorder.isActive || isStartingLearningSession) {
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
            if (sessionRecorder.isActive || isStartingLearningSession) {
                return;
            }

            isStartingLearningSession = true;
            try {
                const predictedLevel = await detector.predictLevel();
                detector.reset();
                sessionRecorder.start(predictedLevel);
                vscode.window.showInformationMessage(
                    "Learning session started. Use ‘AI Coding Buddy: Finish Learning Session’ when you are done."
                );
            } catch (error) {
                console.error("Could not start learning session:", error);
                vscode.window.showErrorMessage("AI Coding Buddy could not start the learning session.");
            } finally {
                isStartingLearningSession = false;
            }
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

    const exportSessionsCommand = vscode.commands.registerCommand(
        "codingBuddy.exportLearningData",
        async () => {
            try {
                const contents = await vscode.workspace.fs.readFile(
                    vscode.Uri.file(sessionRecorder.dataFilePath)
                );
                const destination = await vscode.window.showSaveDialog({
                    saveLabel: "Export Learning Sessions",
                    defaultUri: vscode.Uri.joinPath(
                        context.globalStorageUri,
                        "ai-coding-buddy-learning-sessions.csv"
                    ),
                    filters: { "CSV files": ["csv"] }
                });
                if (destination) {
                    await vscode.workspace.fs.writeFile(destination, contents);
                    vscode.window.showInformationMessage("Learning data exported to the selected file.");
                }
            } catch {
                vscode.window.showInformationMessage("No learning session data is available to export yet.");
            }
        }
    );
    context.subscriptions.push(exportSessionsCommand);

    const clearSessionsCommand = vscode.commands.registerCommand(
        "codingBuddy.clearLearningData",
        async () => {
            const choice = await vscode.window.showWarningMessage(
                "Delete all locally stored AI Coding Buddy learning-session data? This cannot be undone.",
                { modal: true },
                "Delete Data"
            );
            if (choice !== "Delete Data") {
                return;
            }
            await sessionRecorder.clear();
            vscode.window.showInformationMessage("Local learning-session data was deleted.");
        }
    );
    context.subscriptions.push(clearSessionsCommand);

    // RUN ACTIVE FILE IN THE SELECTED LANGUAGE
    const runFileCommand = vscode.commands.registerCommand(
        "codingBuddy.runFile",
        () => runActiveFile(context)
    );
    context.subscriptions.push(runFileCommand);
    // Keep the previous command identifier working for existing keybindings.
    const runPythonAlias = vscode.commands.registerCommand(
        "codingBuddy.runPython",
        () => vscode.commands.executeCommand("codingBuddy.runFile")
    );
    context.subscriptions.push(runPythonAlias);

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
function openControlPanel(context: vscode.ExtensionContext): void {
    if (controlPanel) {
        controlPanel.reveal(vscode.ViewColumn.Beside);
        updateControlPanelState();
        return;
    }
    const nonce = randomBytes(16).toString("base64");
    const panel = vscode.window.createWebviewPanel(
        "codingBuddyControlPanel",
        "AI Coding Buddy",
        vscode.ViewColumn.Beside,
        { enableScripts: true, localResourceRoots: [] }
    );
    controlPanel = panel;
    panel.onDidDispose(() => {
        if (controlPanel === panel) {
            controlPanel = undefined;
        }
    });

    panel.webview.html = createControlPanelHTML(nonce);

    panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message !== "object") {
            return;
        }
        switch (message.command) {
            case "setLevel":
                if ([1, 2, 3].includes(message.level)) {
                    setManualLevel(message.level);
                }
                break;

            case "automatic":
                enableAutomaticMode();
                break;

            case "selectLanguage":
                if (typeof message.language === "string" && ["auto", "python", "java", "c", "cpp"].includes(message.language)) {
                    selectedLanguage = message.language;
                    await context.globalState.update("selectedLanguage", selectedLanguage);
                    updateStatusBar();
                }
                break;

            case "runFile":
                await vscode.commands.executeCommand("codingBuddy.runFile");
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

        updateControlPanelState();
    });
}

// MANUAL LEVEL
function setManualLevel(level: number): void {
    if (![1, 2, 3].includes(level)) {
        return;
    }
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

async function runActiveFile(context: vscode.ExtensionContext): Promise<void> {
    if (isRunningFile) {
        vscode.window.showInformationMessage("AI Coding Buddy is already running a file.");
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a source file before running it.");
        return;
    }

    const language: CodingLanguage | undefined = selectedLanguage === "auto"
        ? languageFromDocument(editor.document.languageId)
        : selectedLanguage as CodingLanguage;
    if (!language) {
        vscode.window.showWarningMessage(
            "Choose Python, Java, C, or C++ in the AI Coding Buddy language dropdown to run this file."
        );
        return;
    }

    if (!vscode.workspace.isTrusted) {
        const approval = await vscode.window.showWarningMessage(
            "This workspace is in Restricted Mode. Running this file executes its code with your account's permissions. Continue only if you trust the file.",
            { modal: true },
            "Run Anyway"
        );
        if (approval !== "Run Anyway") {
            return;
        }
    }

    if (editor.document.isDirty && !(await editor.document.save())) {
        vscode.window.showWarningMessage("Save the file before running it.");
        return;
    }

    if (isRunningFile) {
        return;
    }

    isRunningFile = true;
    sessionRecorder.recordAttempt();
    runOutput.clear();
    runOutput.appendLine(`Running ${editor.document.fileName} as ${language}…`);
    runOutput.show(true);

    try {
        const result = await languageRunner.run(
            editor.document.fileName,
            language,
            context.globalStorageUri.fsPath
        );
        const output = result.output.startsWith("__NOT_FOUND__")
            ? `A required runtime or compiler could not be started. Check that it is installed and available on PATH, or configure its path in Settings. (${result.output.slice("__NOT_FOUND__".length)})`
            : result.output || (result.success ? "Program finished successfully with no output." : "Program exited with an error and no output.");
        runOutput.appendLine(output);

        if (!result.success) {
            detector.recordFailedRun();
            vscode.window.showErrorMessage("AI Coding Buddy: The program did not finish successfully. See the AI Coding Buddy output channel.");
        } else {
            vscode.window.showInformationMessage("AI Coding Buddy: Program finished successfully.");
        }

        if (!manualOverride && !isGeneratingHint) {
            const predictedLevel = await detector.predictLevel();
            await processAutomaticLevel(predictedLevel);
        }
        updateStatusBar();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        runOutput.appendLine(detail);
        detector.recordFailedRun();
        vscode.window.showErrorMessage(`AI Coding Buddy could not run this file: ${detail}`);
    } finally {
        isRunningFile = false;
    }
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
    statusBar.accessibilityInformation = {
        label: `AI Coding Buddy, assistance level ${level}, ${mode} mode. Open control panel.`
    };
    updateControlPanelState();
}

function updateControlPanelState(): void {
    if (!controlPanel) {
        return;
    }
    void controlPanel.webview.postMessage({
        type: "state",
        level: getEffectiveLevel(),
        mode: manualOverride ? "Manual" : "Automatic",
        manualOverride,
        selectedLanguage,
        level1Time: getLevelTimeLimit(1),
        level2Time: getLevelTimeLimit(2),
        level3Time: getLevelTimeLimit(3)
    });
}

// CONTROL PANEL HTML
function createControlPanelHTML(nonce: string): string {
    const level = getEffectiveLevel();
    const mode = manualOverride ? "Manual" : "Automatic";

    const level1Time = getLevelTimeLimit(1);
    const level2Time = getLevelTimeLimit(2);
    const level3Time = getLevelTimeLimit(3);
    const languageOptions: Array<[string, string]> = [
        ["auto", "Auto-detect"],
        ["python", "Python"],
        ["java", "Java"],
        ["c", "C"],
        ["cpp", "C++"]
    ];
    const languageLabel = selectedLanguage === "auto"
        ? "Auto-detect"
        : languageOptions.find(([value]) => value === selectedLanguage)?.[1] ?? "Auto-detect";

    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    max-width: 760px;
    margin: 0 auto;
    padding: 20px clamp(14px, 4vw, 32px) 32px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.5;
}
h1 {
    font-size: 24px;
    margin: 0 0 4px;
}
.subtitle {
    color: var(--vscode-descriptionForeground);
    margin-bottom: 20px;
}
.card {
    padding: 18px;
    margin-bottom: 14px;
    border-radius: 12px;
    background: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-panel-border);
}
.card-title { font-size: 14px; font-weight: 650; }
.level {
    display: inline-flex;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 24px;
    font-weight: 700;
    margin-top: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
}
.mode {
    font-size: 16px;
    margin-top: 8px;
    color: var(--vscode-descriptionForeground);
}
.buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    margin-top: 15px;
}
button {
    border: none;
    border-radius: 7px;
    padding: 10px 12px;
    cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font: inherit;
    transition: background-color 120ms ease, transform 120ms ease, outline-color 120ms ease;
}
button:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
    transform: translateY(-1px);
}
button:active:not(:disabled) { transform: translateY(0); }
button:focus-visible, select:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
}
.active, button[aria-pressed="true"] {
    box-shadow: inset 0 0 0 2px var(--vscode-focusBorder);
}
.time-row {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 9px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
}
.time-row:last-child {
    border-bottom: none;
}
.time-value { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
.hint-button {
    width: 100%;
    margin-top: 10px;
    min-height: 42px;
    font-weight: 600;
}
select {
    margin-top: 8px;
    padding: 9px 32px 9px 10px;
    width: 100%;
    max-width: 340px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 6px;
    font: inherit;
}
.helper { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 7px 0 0; }
.time-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; }
.time-tile { padding: 10px; border-radius: 8px; background: var(--vscode-editor-background); }
.time-tile strong { display:block; font-size: 18px; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
    button { transition: none; }
}
</style>
</head>
<body>
<h1>🤖 AI Coding Buddy</h1>
<div class="subtitle">Adaptive help, at your pace.</div>

<div class="card">
    <div class="card-title">Programming language</div>
    <div><select id="languageSelect" aria-label="Programming language">
        ${languageOptions.map(([value, label]) => `<option value="${value}" ${selectedLanguage === value ? "selected" : ""}>${label}</option>`).join("")}
    </select></div>
    <p class="helper" id="languageSummary">${languageLabel} uses the active editor language when set to Auto-detect.</p>
    <button class="hint-button" id="runButton">▶ &nbsp;Run Current File</button>
</div>

<div class="card">
    <div class="card-title">Current assistance</div>
    <div class="level" id="currentLevel">Level ${level}</div>
    <div class="mode">Mode: <strong id="currentMode">${mode}</strong></div>
</div>

<div class="card">
    <div class="card-title">Choose your help level</div>
    <div class="buttons">
        <button
            data-level="1" aria-pressed="${level === 1 && manualOverride}"
            >
            Level 1<br><small>Let me think</small>
        </button>

        <button
            data-level="2" aria-pressed="${level === 2 && manualOverride}"
            >
            Level 2<br><small>Stronger hint</small>
        </button>

        <button
            data-level="3" aria-pressed="${level === 3 && manualOverride}"
            >
            Level 3<br><small>Direct help</small>
        </button>
    </div>

    <button
        id="automaticButton" aria-pressed="${!manualOverride}"
        style="margin-top:12px;width:100%;"
        >
        🔄 Return to Automatic Detection
    </button>
</div>

<div class="card">
    <div class="card-title">Automatic help timing</div>
    <div class="time-grid">
        <div class="time-tile">Level 1<strong><span id="level1Time">${level1Time}</span>s</strong></div>
        <div class="time-tile">Level 2<strong><span id="level2Time">${level2Time}</span>s</strong></div>
        <div class="time-tile">Level 3<strong><span id="level3Time">${level3Time}</span>s</strong></div>
    </div>
    <p class="helper">Adjust these limits in VS Code Settings → AI Coding Buddy.</p>
</div>

<div class="card">
    <div class="card-title">Quick actions</div>

    <button class="hint-button" id="getHintButton">
        💡 Get Hint
    </button>

    <button class="hint-button" id="resetButton">
        🔄 Reset AI Coding Buddy
    </button>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.querySelectorAll("[data-level]").forEach((button) => {
    button.addEventListener("click", () => setLevel(Number(button.dataset.level)));
});
document.getElementById("languageSelect").addEventListener("change", (event) => {
    selectLanguage(event.target.value);
});
document.getElementById("runButton").addEventListener("click", runFile);
document.getElementById("automaticButton").addEventListener("click", automatic);
document.getElementById("getHintButton").addEventListener("click", getHint);
document.getElementById("resetButton").addEventListener("click", resetBuddy);

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

function selectLanguage(language) {
    vscode.postMessage({ command: "selectLanguage", language: language });
}

function runFile() {
    vscode.postMessage({ command: "runFile" });
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

window.addEventListener("message", (event) => {
    const state = event.data;
    if (!state || state.type !== "state") return;
    document.getElementById("currentLevel").textContent = "Level " + state.level;
    document.getElementById("currentMode").textContent = state.mode;
    document.querySelectorAll("[data-level]").forEach((button) => {
        const active = state.manualOverride && Number(button.dataset.level) === state.level;
        button.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("automaticButton").setAttribute("aria-pressed", String(!state.manualOverride));
    document.getElementById("level1Time").textContent = state.level1Time;
    document.getElementById("level2Time").textContent = state.level2Time;
    document.getElementById("level3Time").textContent = state.level3Time;
    const languageSelect = document.getElementById("languageSelect");
    if (document.activeElement !== languageSelect) languageSelect.value = state.selectedLanguage;
    const option = languageSelect.options[languageSelect.selectedIndex];
    document.getElementById("languageSummary").textContent = option.text + " uses the active editor language when set to Auto-detect.";
});
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
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
