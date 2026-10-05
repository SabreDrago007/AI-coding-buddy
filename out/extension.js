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
const crypto_1 = require("crypto");
const struggleDetector_1 = require("./struggleDetector");
const hintEngine_1 = require("./hintEngine");
const sessionRecorder_1 = require("./sessionRecorder");
const languageRunner_1 = require("./languageRunner");
const setupDiagnostics_1 = require("./setupDiagnostics");
const domain_1 = require("./domain");
let detector;
let hintEngine;
let sessionRecorder;
let languageRunner;
let statusBar;
let runOutput;
let controlView;
let selectedLanguage = "auto";
let currentLevel = 1;
let manualOverride = false;
let manualLevel = 1;
let levelStartedAt = Date.now();
let automaticTimer;
// Prevent automatic level changes while generating a hint.
let isGeneratingHint = false;
let isStartingLearningSession = false;
let isRunningFile = false;
let isAnalyzingLogic = false;
function activate(context) {
    console.log("AI Coding Buddy is now active.");
    detector = new struggleDetector_1.StruggleDetector();
    hintEngine = new hintEngine_1.HintEngine();
    sessionRecorder = new sessionRecorder_1.SessionRecorder(context.globalStorageUri.fsPath);
    languageRunner = new languageRunner_1.LanguageRunner();
    const storedLanguage = context.globalState.get("selectedLanguage", "auto");
    selectedLanguage = (0, domain_1.isCodingLanguage)(storedLanguage) ? storedLanguage : "auto";
    // STATUS BAR
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = "codingBuddy.openControlPanel";
    updateStatusBar();
    statusBar.show();
    context.subscriptions.push(statusBar);
    runOutput = vscode.window.createOutputChannel("AI Coding Buddy");
    context.subscriptions.push(runOutput);
    // TRACK CODE EDITS
    const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
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
    const initialEditor = vscode.window.activeTextEditor;
    if (initialEditor)
        detector.recordCursorMovement(initialEditor.document.uri.toString(), initialEditor.selection.active.line);
    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor)
            return;
        detector.recordCursorMovement(editor.document.uri.toString(), editor.selection.active.line);
        if ((0, domain_1.languageFromDocument)(editor.document.languageId)) {
            void vscode.commands.executeCommand("workbench.view.extension.codingBuddy");
        }
    });
    context.subscriptions.push(activeEditorListener);
    const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor === vscode.window.activeTextEditor && event.selections.length > 0) {
            detector.recordCursorMovement(event.textEditor.document.uri.toString(), event.selections[0].active.line);
        }
    });
    context.subscriptions.push(selectionListener);
    // TRACK ERRORS
    const diagnosticListener = vscode.languages.onDidChangeDiagnostics((event) => {
        for (const uri of event.uris) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            for (const diagnostic of diagnostics) {
                if (diagnostic.severity ===
                    vscode.DiagnosticSeverity.Error) {
                    const errorKey = `${uri.toString()}|` +
                        `${diagnostic.range.start.line}|` +
                        `${diagnostic.range.start.character}|` +
                        diagnostic.message;
                    detector.recordError(errorKey);
                }
            }
        }
    });
    context.subscriptions.push(diagnosticListener);
    // SIDEBAR TUTOR
    const sidebarProvider = {
        resolveWebviewView: (view) => {
            controlView = view;
            view.webview.options = { enableScripts: true };
            view.webview.html = createControlPanelHTML((0, crypto_1.randomBytes)(16).toString("base64"));
            view.onDidDispose(() => {
                if (controlView === view)
                    controlView = undefined;
            });
            view.webview.onDidReceiveMessage(message => handleSidebarMessage(context, message));
            updateControlPanelState();
        }
    };
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("codingBuddy.sidebar", sidebarProvider, { webviewOptions: { retainContextWhenHidden: true } }));
    const controlPanelCommand = vscode.commands.registerCommand("codingBuddy.openControlPanel", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.codingBuddy");
        await vscode.commands.executeCommand("workbench.views.codingBuddy.sidebar.focus");
        updateControlPanelState();
    });
    context.subscriptions.push(controlPanelCommand);
    if (vscode.window.activeTextEditor && (0, domain_1.languageFromDocument)(vscode.window.activeTextEditor.document.languageId)) {
        void vscode.commands.executeCommand("workbench.view.extension.codingBuddy");
    }
    const tutorialCommand = vscode.commands.registerCommand("codingBuddy.startTutorial", () => startQuickTutorial());
    context.subscriptions.push(tutorialCommand);
    const languageCommand = vscode.commands.registerCommand("codingBuddy.selectLanguage", async () => {
        const choices = [
            { label: "Auto-detect", value: "auto" },
            { label: "Python", value: "python" },
            { label: "Java", value: "java" },
            { label: "C", value: "c" },
            { label: "C++", value: "cpp" }
        ];
        const selected = await vscode.window.showQuickPick(choices, {
            placeHolder: "Choose the language for hints and running code"
        });
        if (!selected)
            return;
        selectedLanguage = selected.value;
        await context.globalState.update("selectedLanguage", selectedLanguage);
        updateStatusBar();
        vscode.window.showInformationMessage(`AI Coding Buddy language: ${selected.label}`);
    });
    context.subscriptions.push(languageCommand);
    const timerLimitsCommand = vscode.commands.registerCommand("codingBuddy.configureTimeLimits", () => configureLevelTimeLimits());
    context.subscriptions.push(timerLimitsCommand);
    // GET HINT
    const hintCommand = vscode.commands.registerCommand("codingBuddy.getHint", async () => {
        if (isGeneratingHint) {
            vscode.window.showInformationMessage("AI Coding Buddy is already generating a hint. Please wait.");
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("Open a code file first.");
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
        let endpoint;
        try {
            endpoint = hintEngine.getConfiguredEndpoint();
        }
        catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
            return;
        }
        if (!hintEngine.isLocalEndpoint(endpoint)) {
            const approval = await vscode.window.showWarningMessage(`This hint will send ${codeAtRequest.length} characters of source text to ${endpoint.host} over HTTPS. Continue?`, { modal: true }, "Send Source and Continue");
            if (approval !== "Send Source and Continue") {
                return;
            }
        }
        sessionRecorder.recordHint(levelAtRequest);
        isGeneratingHint = true;
        updateStatusBar();
        try {
            const hint = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `AI Coding Buddy: Generating Level ${levelAtRequest} hint...`,
                cancellable: false
            }, async () => {
                return await hintEngine.generateHint(levelAtRequest, codeAtRequest, languageAtRequest, endpoint);
            });
            const panel = vscode.window.createWebviewPanel("codingBuddyHint", `AI Coding Buddy - Level ${levelAtRequest}`, vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
            panel.webview.html = createHintHTML(levelAtRequest, hint);
        }
        catch (error) {
            console.error("Hint generation failed:", error);
            const message = error instanceof Error
                ? error.message
                : String(error);
            vscode.window.showErrorMessage(`AI Coding Buddy could not generate a hint: ${message}`);
        }
        finally {
            isGeneratingHint = false;
            updateStatusBar();
        }
    });
    context.subscriptions.push(hintCommand);
    // GET STRUGGLE LEVEL
    const levelCommand = vscode.commands.registerCommand("codingBuddy.getLevel", async () => {
        if (!manualOverride && !isGeneratingHint) {
            const predictedLevel = await detector.predictLevel();
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
            `Time on current line: ${features.stuck_line_seconds ?? 0} seconds`,
            `Errors: ${features.errors}`,
            `Failed Runs: ${features.failed_runs}`,
            `Deletions: ${features.deletions}`,
            `Recent deletion bursts: ${features.deletion_bursts ?? 0}`,
            `Rapid navigation bursts: ${features.navigation_bursts ?? 0}`,
            `Recent logic concerns: ${features.logic_concerns ?? 0}`,
            `Rapid Edits: ${features.rapid_edits}`
        ].join("\n");
        vscode.window.showInformationMessage(featureMessage, { modal: true });
    });
    context.subscriptions.push(levelCommand);
    // SET MANUAL LEVEL
    const setLevelCommand = vscode.commands.registerCommand("codingBuddy.setLevel", async () => {
        const selection = await vscode.window.showQuickPick([
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
        ], {
            placeHolder: "Choose the assistance level"
        });
        if (!selection) {
            return;
        }
        setManualLevel(selection.value);
    });
    context.subscriptions.push(setLevelCommand);
    // RETURN TO AUTOMATIC MODE
    const automaticCommand = vscode.commands.registerCommand("codingBuddy.enableAutomatic", () => {
        enableAutomaticMode();
        vscode.window.showInformationMessage("AI Coding Buddy is now using automatic detection.");
    });
    context.subscriptions.push(automaticCommand);
    // PRIVACY-PRESERVING LEARNING SESSION
    const startSessionCommand = vscode.commands.registerCommand("codingBuddy.startLearningSession", async () => {
        if (sessionRecorder.isActive || isStartingLearningSession) {
            vscode.window.showInformationMessage("A learning session is already active. Finish it before starting another.");
            return;
        }
        const choice = await vscode.window.showWarningMessage("Start a learning session? AI Coding Buddy will keep behavior counts and your feedback locally. It will not save source code or upload data. An unfinished session is discarded when VS Code closes.", { modal: true }, "Start Session");
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
            vscode.window.showInformationMessage("Learning session started. Use ‘AI Coding Buddy: Finish Learning Session’ when you are done.");
        }
        catch (error) {
            console.error("Could not start learning session:", error);
            vscode.window.showErrorMessage("AI Coding Buddy could not start the learning session.");
        }
        finally {
            isStartingLearningSession = false;
        }
    });
    context.subscriptions.push(startSessionCommand);
    const finishSessionCommand = vscode.commands.registerCommand("codingBuddy.finishLearningSession", async () => {
        if (!sessionRecorder.isActive) {
            vscode.window.showInformationMessage("There is no active learning session.");
            return;
        }
        const outcome = await vscode.window.showQuickPick([
            { label: "Solved", description: "I reached a working solution", solved: true },
            { label: "Still working", description: "I have not solved it yet", solved: false }
        ], { placeHolder: "How did the session go?" });
        if (!outcome) {
            return;
        }
        try {
            await sessionRecorder.finish(outcome.solved, detector.getFeatures());
            vscode.window.showInformationMessage("Learning session saved locally. No source code was recorded.");
            detector.reset();
        }
        catch (error) {
            console.error("Could not save learning session:", error);
            vscode.window.showErrorMessage("AI Coding Buddy could not save the learning session.");
        }
    });
    context.subscriptions.push(finishSessionCommand);
    const exportSessionsCommand = vscode.commands.registerCommand("codingBuddy.exportLearningData", async () => {
        try {
            const contents = await vscode.workspace.fs.readFile(vscode.Uri.file(sessionRecorder.dataFilePath));
            const destination = await vscode.window.showSaveDialog({
                saveLabel: "Export Learning Sessions",
                defaultUri: vscode.Uri.joinPath(context.globalStorageUri, "ai-coding-buddy-learning-sessions.csv"),
                filters: { "CSV files": ["csv"] }
            });
            if (destination) {
                await vscode.workspace.fs.writeFile(destination, contents);
                vscode.window.showInformationMessage("Learning data exported to the selected file.");
            }
        }
        catch {
            vscode.window.showInformationMessage("No learning session data is available to export yet.");
        }
    });
    context.subscriptions.push(exportSessionsCommand);
    const clearSessionsCommand = vscode.commands.registerCommand("codingBuddy.clearLearningData", async () => {
        const choice = await vscode.window.showWarningMessage("Delete all locally stored AI Coding Buddy learning-session data? This cannot be undone.", { modal: true }, "Delete Data");
        if (choice !== "Delete Data") {
            return;
        }
        await sessionRecorder.clear();
        vscode.window.showInformationMessage("Local learning-session data was deleted.");
    });
    context.subscriptions.push(clearSessionsCommand);
    // RUN ACTIVE FILE IN THE SELECTED LANGUAGE
    const runFileCommand = vscode.commands.registerCommand("codingBuddy.runFile", () => runActiveFile(context));
    context.subscriptions.push(runFileCommand);
    // Keep the previous command identifier working for existing keybindings.
    const runPythonAlias = vscode.commands.registerCommand("codingBuddy.runPython", () => vscode.commands.executeCommand("codingBuddy.runFile"));
    context.subscriptions.push(runPythonAlias);
    const setupCommand = vscode.commands.registerCommand("codingBuddy.checkSetup", async () => {
        const channel = vscode.window.createOutputChannel("AI Coding Buddy Setup");
        context.subscriptions.push(channel);
        channel.clear();
        channel.appendLine("AI Coding Buddy setup check\n");
        const checks = await new setupDiagnostics_1.SetupDiagnostics().check(context.extensionPath);
        for (const check of checks)
            channel.appendLine(`${check.status === "ready" ? "✓" : check.status === "action" ? "!" : "i"} ${check.label}: ${check.details}`);
        channel.show(true);
    });
    context.subscriptions.push(setupCommand);
    const trainSessionsCommand = vscode.commands.registerCommand("codingBuddy.trainFromSessions", async () => {
        const choice = await vscode.window.showWarningMessage("Train a local model using only manually selected assistance levels from your learning-session CSV? The script ignores unlabeled sessions and does not upload data. Manual levels are preference labels, not objective ground truth.", { modal: true }, "Continue");
        if (choice !== "Continue")
            return;
        const selected = await vscode.window.showOpenDialog({
            canSelectMany: false, openLabel: "Choose learning-session CSV",
            filters: { "CSV files": ["csv"] },
            defaultUri: vscode.Uri.file(sessionRecorder.dataFilePath)
        });
        if (!selected?.[0])
            return;
        const modelPath = vscode.Uri.joinPath(context.globalStorageUri, "session_struggle_model.pkl").fsPath;
        const scriptPath = vscode.Uri.joinPath(context.extensionUri, "ml", "train_from_sessions.py").fsPath;
        const output = vscode.window.createOutputChannel("AI Coding Buddy Training");
        context.subscriptions.push(output);
        output.clear();
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Training local model from labeled sessions…", cancellable: false }, () => languageRunner.runPythonScript(scriptPath, [selected[0].fsPath, modelPath], context.globalStorageUri.fsPath));
        output.appendLine(result.output || (result.success ? "Training completed." : "Training failed."));
        output.show(true);
        if (!result.success) {
            vscode.window.showErrorMessage("Training did not complete. See AI Coding Buddy Training output.");
            return;
        }
        const useModel = await vscode.window.showInformationMessage("Local model trained. Use it for future struggle estimates?", "Use Model", "Keep Bundled Model");
        if (useModel === "Use Model") {
            await vscode.workspace.getConfiguration("codingBuddy").update("modelPath", modelPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage("Using your local model. Set AI Coding Buddy › Model Path to empty to restore the bundled model.");
        }
    });
    context.subscriptions.push(trainSessionsCommand);
    const interactiveCommand = vscode.commands.registerCommand("codingBuddy.runInteractive", () => runInteractiveFile(context));
    context.subscriptions.push(interactiveCommand);
    const logicReviewCommand = vscode.commands.registerCommand("codingBuddy.checkLogic", (taskDescription) => checkLogic(context, taskDescription));
    context.subscriptions.push(logicReviewCommand);
    // RESET
    const resetCommand = vscode.commands.registerCommand("codingBuddy.reset", () => {
        detector.reset();
        manualOverride = false;
        currentLevel = 1;
        levelStartedAt = Date.now();
        updateStatusBar();
        vscode.window.showInformationMessage("AI Coding Buddy has been reset to automatic Level 1.");
    });
    context.subscriptions.push(resetCommand);
    // AUTOMATIC LEVEL CHECK
    automaticTimer = setInterval(async () => {
        if (manualOverride || isGeneratingHint) {
            return;
        }
        try {
            const predictedLevel = await detector.predictLevel();
            await processAutomaticLevel(predictedLevel);
            updateStatusBar();
        }
        catch (error) {
            console.error("Automatic level detection error:", error);
        }
    }, 5000);
    context.subscriptions.push({
        dispose: () => clearInterval(automaticTimer)
    });
    context.subscriptions.push({
        dispose: () => detector.dispose()
    });
}
// SIDEBAR ACTIONS
async function handleSidebarMessage(context, message) {
    if (!message || typeof message !== "object") {
        return;
    }
    const request = message;
    switch (request.command) {
        case "setLevel":
            if ((0, domain_1.isAssistanceLevel)(request.level)) {
                setManualLevel(request.level);
            }
            break;
        case "automatic":
            enableAutomaticMode();
            break;
        case "selectLanguage":
            if ((0, domain_1.isCodingLanguage)(request.language)) {
                selectedLanguage = request.language;
                await context.globalState.update("selectedLanguage", selectedLanguage);
                updateStatusBar();
            }
            break;
        case "tutorial":
            await vscode.commands.executeCommand("codingBuddy.startTutorial");
            break;
        case "configureTimeLimits":
            await vscode.commands.executeCommand("codingBuddy.configureTimeLimits");
            break;
        case "runFile":
            await vscode.commands.executeCommand("codingBuddy.runFile");
            break;
        case "runInteractive":
            await vscode.commands.executeCommand("codingBuddy.runInteractive");
            break;
        case "checkSetup":
            await vscode.commands.executeCommand("codingBuddy.checkSetup");
            break;
        case "trainSessions":
            await vscode.commands.executeCommand("codingBuddy.trainFromSessions");
            break;
        case "analyzeLogic":
            await vscode.commands.executeCommand("codingBuddy.checkLogic", typeof request.taskDescription === "string" ? request.taskDescription : "");
            break;
        case "reset":
            detector.reset();
            manualOverride = false;
            currentLevel = 1;
            levelStartedAt = Date.now();
            updateStatusBar();
            break;
        case "getHint":
            await vscode.commands.executeCommand("codingBuddy.getHint");
            break;
    }
    updateControlPanelState();
}
// MANUAL LEVEL
function setManualLevel(level) {
    if (!(0, domain_1.isAssistanceLevel)(level)) {
        return;
    }
    manualOverride = true;
    manualLevel = level;
    sessionRecorder.recordManualLevel(level);
    currentLevel = level;
    levelStartedAt = Date.now();
    updateStatusBar();
    vscode.window.showInformationMessage(`Manual override: Level ${level}`);
}
async function configureLevelTimeLimits() {
    const config = vscode.workspace.getConfiguration("codingBuddy");
    const updates = [];
    for (const [key, label, fallback] of [
        ["level1TimeLimit", "Level 1", 10],
        ["level2TimeLimit", "Level 2", 30],
        ["level3TimeLimit", "Level 3", 60]
    ]) {
        const value = await vscode.window.showInputBox({
            title: `Configure ${label} recheck interval`,
            prompt: "Seconds before the next evidence-based level check. Time alone never increases assistance.",
            value: String(config.get(key, fallback)),
            validateInput: input => {
                const seconds = Number(input);
                return Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600
                    ? undefined
                    : "Enter a whole number from 1 to 3600 seconds.";
            }
        });
        if (value === undefined)
            return;
        updates.push([key, label, Number(value)]);
    }
    for (const [key, , seconds] of updates) {
        await config.update(key, seconds, vscode.ConfigurationTarget.Global);
    }
    updateControlPanelState();
    vscode.window.showInformationMessage("AI Coding Buddy level time limits updated.");
}
async function startQuickTutorial() {
    const steps = [
        {
            title: "1 of 5 · Open the tutor panel",
            message: "Select the AI Coding Buddy lightbulb icon in the Activity Bar to open its sidebar. It stays beside your code and contains language, level, timer, hint, logic review, and run controls."
        },
        {
            title: "2 of 5 · Choose a language",
            message: "Set Python, Java, C, or C++ in the Programming language menu. Auto-detect follows the active editor. This choice is used for hints and running the current file."
        },
        {
            title: "3 of 5 · Pick how much help you want",
            message: "Level 1 gives a broad hint, Level 2 gives a more focused strategy, and Level 3 gives a direct answer with an explanation. Choose Automatic to let editor evidence guide the level."
        },
        {
            title: "4 of 5 · Set recheck intervals",
            message: "Use ‘Configure Level Time Limits’ to set each level’s minimum recheck interval from 1 to 3600 seconds. Waiting alone never raises your assistance level."
        },
        {
            title: "5 of 5 · Ask for help",
            message: "Use Get a hint for coaching or Check Code Logic to review algorithm intent and invariants. Ollama must be running locally for generated guidance."
        }
    ];
    for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        const actions = index === 0
            ? ["Next", "Open Sidebar", "Finish"]
            : index === steps.length - 1
                ? ["Finish", "Back"]
                : ["Next", "Back", "Finish"];
        const action = await vscode.window.showInformationMessage(step.message, { modal: true, detail: step.title }, ...actions);
        if (action === "Open Sidebar") {
            await vscode.commands.executeCommand("codingBuddy.openControlPanel");
            index--;
        }
        else if (action === "Back") {
            index = Math.max(-1, index - 2);
        }
        else if (action !== "Next") {
            return;
        }
    }
}
async function runActiveFile(context) {
    if (isRunningFile) {
        vscode.window.showInformationMessage("AI Coding Buddy is already running a file.");
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a source file before running it.");
        return;
    }
    const language = selectedLanguage === "auto"
        ? (0, domain_1.languageFromDocument)(editor.document.languageId)
        : selectedLanguage;
    if (!language) {
        vscode.window.showWarningMessage("Choose Python, Java, C, or C++ in the AI Coding Buddy language dropdown to run this file.");
        return;
    }
    if (!vscode.workspace.isTrusted) {
        const approval = await vscode.window.showWarningMessage("This workspace is in Restricted Mode. Running this file executes its code with your account's permissions. Continue only if you trust the file.", { modal: true }, "Run Anyway");
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
        const result = await languageRunner.run(editor.document.fileName, language, context.globalStorageUri.fsPath);
        const output = result.output.startsWith("__NOT_FOUND__")
            ? `A required runtime or compiler could not be started. Check that it is installed and available on PATH, or configure its path in Settings. (${result.output.slice("__NOT_FOUND__".length)})`
            : result.output || (result.success ? "Program finished successfully with no output." : "Program exited with an error and no output.");
        runOutput.appendLine(output);
        if (!result.success) {
            detector.recordFailedRun();
            vscode.window.showErrorMessage("AI Coding Buddy: The program did not finish successfully. See the AI Coding Buddy output channel.");
        }
        else {
            vscode.window.showInformationMessage("AI Coding Buddy: Program finished successfully.");
        }
        if (!manualOverride && !isGeneratingHint) {
            const predictedLevel = await detector.predictLevel();
            await processAutomaticLevel(predictedLevel);
        }
        updateStatusBar();
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        runOutput.appendLine(detail);
        detector.recordFailedRun();
        vscode.window.showErrorMessage(`AI Coding Buddy could not run this file: ${detail}`);
    }
    finally {
        isRunningFile = false;
    }
}
async function checkLogic(context, providedTask) {
    if (isAnalyzingLogic || isGeneratingHint) {
        vscode.window.showInformationMessage("AI Coding Buddy is already reviewing code or generating a hint.");
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a source file before checking its logic.");
        return;
    }
    const code = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    if (!code.trim()) {
        vscode.window.showWarningMessage("Select or enter some code to review.");
        return;
    }
    const language = selectedLanguage === "auto" ? editor.document.languageId : selectedLanguage;
    let intendedBehavior = providedTask;
    if (intendedBehavior === undefined) {
        intendedBehavior = await vscode.window.showInputBox({
            title: "Check Code Logic",
            prompt: "What DSA task should this code solve? Optional; AI Coding Buddy will infer it from names, comments, and code structure.",
            placeHolder: "For example: find a shortest path, reverse a linked list, or maintain a sliding window",
            ignoreFocusOut: true
        });
        if (intendedBehavior === undefined)
            return;
    }
    let endpoint;
    try {
        endpoint = hintEngine.getConfiguredEndpoint();
    }
    catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        return;
    }
    if (!hintEngine.isLocalEndpoint(endpoint)) {
        const approval = await vscode.window.showWarningMessage(`This logic review and any follow-up hint will send ${code.length} characters of source text and, if provided, your task description to ${endpoint.host} over HTTPS. Continue?`, { modal: true }, "Review and Continue");
        if (approval !== "Review and Continue")
            return;
    }
    isAnalyzingLogic = true;
    isGeneratingHint = true;
    updateStatusBar();
    try {
        let review = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "AI Coding Buddy: Checking algorithm and code logic…", cancellable: false }, () => hintEngine.analyzeLogic(code, language, (intendedBehavior ?? "").trim(), endpoint));
        if (!intendedBehavior.trim() && review.intentConfidence >= 0.65) {
            const action = await vscode.window.showInformationMessage(`I think this code is intended to: ${review.inferredIntent}. Is that the task you want checked?`, "Yes, Check This", "Clarify Task");
            if (action === "Yes, Check This") {
                intendedBehavior = review.inferredIntent;
            }
            else if (action === "Clarify Task") {
                const clarification = await vscode.window.showInputBox({
                    title: "Clarify the DSA Task",
                    prompt: "Describe the operation or expected result in one sentence.",
                    placeHolder: "For example: reverse node links in place, not traverse and print them",
                    ignoreFocusOut: true
                });
                if (clarification === undefined || !clarification.trim())
                    return;
                intendedBehavior = clarification;
                review = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "AI Coding Buddy: Rechecking against your task…", cancellable: false }, () => hintEngine.analyzeLogic(code, language, (intendedBehavior ?? "").trim(), endpoint));
            }
            else {
                return;
            }
        }
        if (review.intentConfidence < 0.65 || !intendedBehavior.trim()) {
            const action = await vscode.window.showWarningMessage(`I could not confidently establish the task. Current guess: ${review.inferredIntent || "unclear"}. Add the intended operation or expected result so I do not check the wrong algorithm.`, "Clarify Task");
            if (action !== "Clarify Task")
                return;
            const clarification = await vscode.window.showInputBox({
                title: "Clarify the DSA Task",
                prompt: "Describe the operation or expected result in one sentence.",
                placeHolder: "For example: reverse node links in place, not traverse and print them",
                ignoreFocusOut: true
            });
            if (clarification === undefined || !clarification.trim())
                return;
            intendedBehavior = clarification;
            review = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "AI Coding Buddy: Rechecking against your task…", cancellable: false }, () => hintEngine.analyzeLogic(code, language, (intendedBehavior ?? "").trim(), endpoint));
        }
        const confidentIssue = review.issueDetected && review.confidence >= 0.72;
        let response;
        let level = getEffectiveLevel();
        if (confidentIssue) {
            detector.recordLogicConcern();
            if (!manualOverride && currentLevel < 2) {
                currentLevel = 2;
                levelStartedAt = Date.now();
                updateStatusBar();
            }
            level = getEffectiveLevel();
            sessionRecorder.recordHint(level);
            const hint = await hintEngine.generateHint(level, code, language, endpoint, intendedBehavior.trim() || review.inferredIntent);
            const findingLabel = level === 1
                ? "Let's compare the implementation with the task goal."
                : level === 2
                    ? "The code may not meet the requested behavior."
                    : `Likely ${review.category} issue${review.line ? ` near line ${review.line}` : ""} (${Math.round(review.confidence * 100)}% confidence).`;
            response = `${findingLabel}\n\n${hint}`;
        }
        else {
            response = review.intentConfidence < 0.65
                ? `I still could not confidently determine the intended DSA operation (${review.inferredIntent || "unclear"}). Give a more specific task description or a sample input and expected output, then check again.`
                : review.issueDetected
                    ? `The review found a possible ${review.category} concern, but confidence was too low to raise assistance. Refine the task description or include a relevant example, then check again.`
                    : `No likely behavior-affecting logic issue was identified (${Math.round(review.confidence * 100)}% confidence). If the result is still wrong, add a concrete input/output example to the task description and check again.`;
        }
        const resultKind = confidentIssue ? "concern" : review.intentConfidence < 0.65 || review.issueDetected ? "uncertain" : "clear";
        const taskSummary = intendedBehavior.trim() || review.inferredIntent;
        const panel = vscode.window.createWebviewPanel("codingBuddyLogicReview", "AI Coding Buddy — Logic Review", vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
        panel.webview.html = createLogicReviewHTML(level, taskSummary, response, resultKind);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`AI Coding Buddy could not check this code's logic: ${detail}`);
    }
    finally {
        isAnalyzingLogic = false;
        isGeneratingHint = false;
        updateStatusBar();
    }
}
async function runInteractiveFile(context) {
    if (isRunningFile) {
        vscode.window.showInformationMessage("AI Coding Buddy is already preparing or running a file.");
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a source file before running it.");
        return;
    }
    const language = selectedLanguage === "auto" ? (0, domain_1.languageFromDocument)(editor.document.languageId) : selectedLanguage;
    if (!language) {
        vscode.window.showWarningMessage("Choose Python, Java, C, or C++ in the AI Coding Buddy language dropdown.");
        return;
    }
    if (!vscode.workspace.isTrusted) {
        const approval = await vscode.window.showWarningMessage("Interactive execution runs code with your account's permissions and can access files and the network. Continue only if you trust this source.", { modal: true }, "Run Anyway");
        if (approval !== "Run Anyway")
            return;
    }
    if (editor.document.isDirty && !(await editor.document.save())) {
        vscode.window.showWarningMessage("Save the file before running it.");
        return;
    }
    isRunningFile = true;
    try {
        const program = await languageRunner.prepareInteractive(editor.document.fileName, language, context.globalStorageUri.fsPath);
        let cleaned = false;
        const cleanup = () => {
            if (cleaned)
                return;
            cleaned = true;
            void program.cleanup();
        };
        const terminal = vscode.window.createTerminal({ name: `AI Buddy • ${language}`, cwd: program.cwd, shellPath: program.executable, shellArgs: program.args });
        const closeListener = vscode.window.onDidCloseTerminal(closed => {
            if (closed === terminal) {
                cleanup();
                closeListener.dispose();
            }
        });
        context.subscriptions.push(closeListener);
        terminal.show(true);
        sessionRecorder.recordAttempt();
        vscode.window.showInformationMessage("Program opened in an interactive terminal. Enter input there; close the terminal when finished.");
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`AI Coding Buddy could not prepare this program: ${detail}`);
        detector.recordFailedRun();
    }
    finally {
        isRunningFile = false;
    }
}
// AUTOMATIC MODE
function enableAutomaticMode() {
    manualOverride = false;
    currentLevel = 1;
    levelStartedAt = Date.now();
    updateStatusBar();
}
// EFFECTIVE LEVEL
function getEffectiveLevel() {
    return manualOverride ? manualLevel : currentLevel;
}
// AUTOMATIC LEVEL PROCESSING
async function processAutomaticLevel(predictedLevel) {
    // Do not change the level while a hint is being generated.
    if (isGeneratingHint) {
        return currentLevel;
    }
    const elapsedSeconds = Math.floor((Date.now() - levelStartedAt) / 1000);
    const waitTime = getLevelTimeLimit(currentLevel);
    const previousLevel = currentLevel;
    const nextLevel = (0, domain_1.nextAutomaticLevel)(currentLevel, predictedLevel, elapsedSeconds, waitTime, (0, domain_1.hasStruggleEvidence)(detector.getFeatures(), predictedLevel));
    if (nextLevel === previousLevel)
        return currentLevel;
    currentLevel = nextLevel;
    levelStartedAt = Date.now();
    if (currentLevel > previousLevel) {
        vscode.window.showInformationMessage(`AI Coding Buddy increased assistance to Level ${currentLevel}.`);
    }
    return currentLevel;
}
// TIME LIMITS
function getLevelTimeLimit(level) {
    const config = vscode.workspace.getConfiguration("codingBuddy");
    if (level === 1) {
        return config.get("level1TimeLimit", 10);
    }
    if (level === 2) {
        return config.get("level2TimeLimit", 30);
    }
    return config.get("level3TimeLimit", 60);
}
// STATUS BAR
function updateStatusBar() {
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
function updateControlPanelState() {
    if (!controlView) {
        return;
    }
    void controlView.webview.postMessage({
        type: "state",
        level: getEffectiveLevel(),
        mode: manualOverride ? "Manual" : "Automatic",
        isAnalyzingLogic,
        manualOverride,
        selectedLanguage,
        level1Time: getLevelTimeLimit(1),
        level2Time: getLevelTimeLimit(2),
        level3Time: getLevelTimeLimit(3)
    });
}
// CONTROL PANEL HTML
function createControlPanelHTML(nonce) {
    const level = getEffectiveLevel();
    const mode = manualOverride ? "Manual" : "Automatic";
    const level1Time = getLevelTimeLimit(1);
    const level2Time = getLevelTimeLimit(2);
    const level3Time = getLevelTimeLimit(3);
    const languageOptions = [
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
    padding: 12px 10px 24px;
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
    padding: 13px;
    margin-bottom: 14px;
    border-radius: 12px;
    background: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-panel-border);
}
.card + .card { margin-top: 12px; }
.page-header {
    display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
    padding:4px 0 18px; border-bottom:1px solid var(--vscode-panel-border); margin-bottom:18px;
}
.brand-mark { font-size:13px; font-weight:700; letter-spacing:.04em; color:var(--vscode-textLink-foreground); text-transform:uppercase; }
.subtitle { max-width:560px; margin-top:5px; }
.mode-pill { flex:0 0 auto; padding:5px 10px; border-radius:999px; border:1px solid var(--vscode-panel-border); color:var(--vscode-descriptionForeground); font-size:12px; }
.review-card { border-left:3px solid var(--vscode-focusBorder); }
.section-kicker { color:var(--vscode-descriptionForeground); font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; margin-bottom:6px; }
.review-title { font-size:18px; font-weight:650; margin:0; }
.review-copy { max-width:620px; color:var(--vscode-descriptionForeground); margin:6px 0 14px; }
.field-label { display:block; font-size:13px; font-weight:600; margin:14px 0 6px; }
textarea {
    box-sizing:border-box; width:100%; min-height:66px; resize:vertical;
    padding:9px 10px; color:var(--vscode-input-foreground); background:var(--vscode-input-background);
    border:1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius:6px;
    font:inherit; line-height:1.45;
}
textarea:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
.button-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
.button-row .hint-button { margin-top:0; }
.secondary-button { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
.secondary-button:hover:not(:disabled) { background:var(--vscode-button-secondaryHoverBackground); }
details summary { cursor:pointer; color:var(--vscode-textLink-foreground); font-weight:600; padding:4px 0; }
details[open] summary { margin-bottom:8px; }
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
    grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
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
<header class="page-header">
    <div><div class="brand-mark">AI Coding Buddy</div><h1>Learning workspace</h1><div class="subtitle">Reasoning support that adapts to your progress.</div></div>
    <div class="mode-pill" id="headerMode">${mode} mode</div>
</header>

<div class="card">
    <div class="section-kicker">Environment</div><div class="card-title">Programming language</div>
    <div><select id="languageSelect" aria-label="Programming language">
        ${languageOptions.map(([value, label]) => `<option value="${value}" ${selectedLanguage === value ? "selected" : ""}>${label}</option>`).join("")}
    </select></div>
    <p class="helper" id="languageSummary">${languageLabel} uses the active editor language when set to Auto-detect.</p>
</div>

<div class="card review-card">
    <div class="section-kicker">Hint</div><div class="card-title">Get help with your code</div>
    <p class="helper">Ask for guidance at your current assistance level.</p>
    <button class="hint-button" id="getHintButton">Get a hint</button>
</div>

<div class="card review-card">
    <div class="section-kicker">Code review</div>
    <h2 class="review-title">Check algorithm and logic</h2>
    <p class="review-copy">Reviews DSA intent, invariants, indexing, control flow, and language-specific APIs. The task is optional; if it is blank, AI Coding Buddy will infer the goal and ask you to confirm when uncertain.</p>
    <label class="field-label" for="taskDescription">What should this code do? <span class="helper">Optional</span></label>
    <textarea id="taskDescription" aria-describedby="taskHelp" placeholder="e.g. Find the shortest path from a source to every reachable node"></textarea>
    <p class="helper" id="taskHelp">Select a code region first for a focused review, or leave nothing selected to review the file.</p>
    <button class="hint-button" id="logicButton">Check Code Logic</button>
</div>

<div class="card">
    <div class="section-kicker">Assistance</div><div class="card-title">Current level</div>
    <div class="level" id="currentLevel">Level ${level}</div>
    <div class="mode"><strong id="currentMode">${mode}</strong> mode · Help adapts to your progress.</div>
</div>

<div class="card">
    <div class="section-kicker">Control</div><div class="card-title">Choose your help level</div>
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
    <div class="card-title">Evidence checks and cooldown</div>
    <div class="time-grid">
        <div class="time-tile">Level 1<strong><span id="level1Time">${level1Time}</span>s</strong></div>
        <div class="time-tile">Level 2<strong><span id="level2Time">${level2Time}</span>s</strong></div>
        <div class="time-tile">Level 3<strong><span id="level3Time">${level3Time}</span>s</strong></div>
    </div>
    <p class="helper">These are minimum recheck intervals after a level change. Time passing alone never raises assistance; editor evidence is required.</p>
    <button class="hint-button secondary-button" id="configureTimesButton">Configure level time limits</button>
</div>

<div class="card">
    <div class="section-kicker">Actions</div><div class="card-title">Work with your code</div>
    <div class="button-row" style="margin-top:10px">
        <button class="hint-button secondary-button" id="tutorialButton">Start quick tutorial</button>
        <button class="hint-button secondary-button" id="runButton">Run current file</button>
        <button class="hint-button secondary-button" id="interactiveButton">Run interactively</button>
    </div>
    <details style="margin-top:16px">
        <summary>Settings and learning data</summary>
        <div class="button-row">
            <button class="hint-button secondary-button" id="setupButton">Check setup</button>
            <button class="hint-button secondary-button" id="trainButton">Train from labeled sessions</button>
            <button class="hint-button secondary-button" id="resetButton">Reset assistance</button>
        </div>
    </details>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.querySelectorAll("[data-level]").forEach((button) => {
    button.addEventListener("click", () => setLevel(Number(button.dataset.level)));
});
document.getElementById("languageSelect").addEventListener("change", (event) => {
    selectLanguage(event.target.value);
});
document.getElementById("interactiveButton").addEventListener("click", runInteractive);
document.getElementById("runButton").addEventListener("click", runFile);
document.getElementById("setupButton").addEventListener("click", checkSetup);
document.getElementById("trainButton").addEventListener("click", trainSessions);
document.getElementById("automaticButton").addEventListener("click", automatic);
document.getElementById("getHintButton").addEventListener("click", getHint);
document.getElementById("logicButton").addEventListener("click", checkLogic);
document.getElementById("resetButton").addEventListener("click", resetBuddy);
document.getElementById("tutorialButton").addEventListener("click", startTutorial);
document.getElementById("configureTimesButton").addEventListener("click", configureTimeLimits);

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

function runInteractive() {
    vscode.postMessage({ command: "runInteractive" });
}

function checkSetup() {
    vscode.postMessage({ command: "checkSetup" });
}

function trainSessions() {
    vscode.postMessage({ command: "trainSessions" });
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

function checkLogic() {
    const button = document.getElementById("logicButton");
    button.disabled = true;
    button.textContent = "Reviewing code…";
    vscode.postMessage({ command: "analyzeLogic", taskDescription: document.getElementById("taskDescription").value });
}

function startTutorial() {
    vscode.postMessage({ command: "tutorial" });
}

function configureTimeLimits() {
    vscode.postMessage({ command: "configureTimeLimits" });
}

window.addEventListener("message", (event) => {
    const state = event.data;
    if (!state || state.type !== "state") return;
    document.getElementById("currentLevel").textContent = "Level " + state.level;
    document.getElementById("currentMode").textContent = state.mode;
    document.getElementById("headerMode").textContent = state.mode + " mode";
    const logicButton = document.getElementById("logicButton");
    logicButton.disabled = Boolean(state.isAnalyzingLogic);
    logicButton.textContent = state.isAnalyzingLogic ? "Reviewing code…" : "Check Code Logic";
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
function createLogicReviewHTML(level, task, guidance, resultKind) {
    const status = resultKind === "concern" ? "Possible issue found" : resultKind === "uncertain" ? "Needs clarification" : "No likely issue found";
    const statusColor = resultKind === "concern" ? "var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground))" : resultKind === "clear" ? "var(--vscode-testing-iconPassed, var(--vscode-textLink-foreground))" : "var(--vscode-descriptionForeground)";
    const safeTask = (0, domain_1.escapeHtml)(task || "Task could not be inferred");
    const safeGuidance = (0, domain_1.escapeHtml)(guidance).replace(/\r?\n/g, "<br>");
    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 760px; margin: 0 auto; padding: 28px clamp(16px, 5vw, 40px); color: var(--vscode-foreground); background: var(--vscode-editor-background); line-height: 1.6; }
.eyebrow { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
h1 { font-size: 25px; margin: 5px 0 14px; }
.status { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 999px; color: ${statusColor}; font-size: 13px; font-weight: 650; }
.card { margin-top: 16px; padding: 18px 20px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: var(--vscode-textBlockQuote-background); }
h2 { margin: 0 0 8px; font-size: 14px; font-weight: 650; }
.task { color: var(--vscode-foreground); }
.guidance { font-size: 15px; }
.level { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 14px; }
</style>
</head>
<body>
<div class="eyebrow">AI Coding Buddy · DSA Review</div>
<h1>Logic review</h1>
<div class="status">${status}</div>
<section class="card task"><h2>Task being checked</h2><div>${safeTask}</div></section>
<section class="card guidance"><h2>Guidance</h2><div>${safeGuidance}</div><div class="level">Level ${level} assistance</div></section>
</body>
</html>`;
}
function createHintHTML(level, hint) {
    const escapedHint = (0, domain_1.escapeHtml)(hint).replace(/\r?\n/g, "<br>");
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
function deactivate() {
    if (automaticTimer) {
        clearInterval(automaticTimer);
    }
    if (detector) {
        detector.dispose();
    }
}

