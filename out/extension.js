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
let controlPanel;
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
        if (editor)
            detector.recordCursorMovement(editor.document.uri.toString(), editor.selection.active.line);
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
    // CONTROL PANEL
    const controlPanelCommand = vscode.commands.registerCommand("codingBuddy.openControlPanel", () => openControlPanel(context));
    context.subscriptions.push(controlPanelCommand);
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
    const logicReviewCommand = vscode.commands.registerCommand("codingBuddy.checkLogic", () => checkLogic(context));
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
// CONTROL PANEL
function openControlPanel(context) {
    if (controlPanel) {
        controlPanel.reveal(vscode.ViewColumn.Beside);
        updateControlPanelState();
        return;
    }
    const nonce = (0, crypto_1.randomBytes)(16).toString("base64");
    const panel = vscode.window.createWebviewPanel("codingBuddyControlPanel", "AI Coding Buddy", vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
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
                if ((0, domain_1.isAssistanceLevel)(message.level)) {
                    setManualLevel(message.level);
                }
                break;
            case "automatic":
                enableAutomaticMode();
                break;
            case "selectLanguage":
                if ((0, domain_1.isCodingLanguage)(message.language)) {
                    selectedLanguage = message.language;
                    await context.globalState.update("selectedLanguage", selectedLanguage);
                    updateStatusBar();
                }
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
                await vscode.commands.executeCommand("codingBuddy.checkLogic");
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
    });
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
async function checkLogic(context) {
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
    const intendedBehavior = await vscode.window.showInputBox({
        title: "Check Code Logic",
        prompt: "Describe the required behavior or postcondition. This is required to distinguish similar algorithms.",
        placeHolder: "For example: mirror every node's left and right subtrees; do not just visit the nodes",
        ignoreFocusOut: true
    });
    if (intendedBehavior === undefined)
        return;
    if (!intendedBehavior.trim()) {
        vscode.window.showWarningMessage("Describe what the code should do before checking its logic.");
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
        const approval = await vscode.window.showWarningMessage(`This logic review and any follow-up hint will send ${code.length} characters of source text and your task description to ${endpoint.host} over HTTPS. Continue?`, { modal: true }, "Review and Continue");
        if (approval !== "Review and Continue")
            return;
    }
    isAnalyzingLogic = true;
    isGeneratingHint = true;
    updateStatusBar();
    try {
        const review = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "AI Coding Buddy: Checking algorithm and code logic…", cancellable: false }, () => hintEngine.analyzeLogic(code, language, intendedBehavior.trim(), endpoint));
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
            const hint = await hintEngine.generateHint(level, code, language, endpoint, intendedBehavior.trim());
            const findingLabel = level === 1
                ? "Let's compare the implementation with the task goal."
                : level === 2
                    ? "The code may not meet the requested behavior."
                    : `Likely ${review.category} issue${review.line ? ` near line ${review.line}` : ""} (${Math.round(review.confidence * 100)}% confidence).`;
            response = `${findingLabel}\n\n${hint}`;
        }
        else {
            response = review.issueDetected
                ? `The review found a possible ${review.category} concern, but confidence was too low to raise assistance. Refine the task description or include a relevant example, then check again.`
                : `No likely behavior-affecting logic issue was identified (${Math.round(review.confidence * 100)}% confidence). If the result is still wrong, add a concrete input/output example to the task description and check again.`;
        }
        const panel = vscode.window.createWebviewPanel("codingBuddyLogicReview", `AI Coding Buddy Logic Check - Level ${level}`, vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
        panel.webview.html = createHintHTML(level, response);
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
    <button class="hint-button" id="interactiveButton">⌨ &nbsp;Run Interactively</button>
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
    <div class="card-title">Evidence checks and cooldown</div>
    <div class="time-grid">
        <div class="time-tile">Level 1<strong><span id="level1Time">${level1Time}</span>s</strong></div>
        <div class="time-tile">Level 2<strong><span id="level2Time">${level2Time}</span>s</strong></div>
        <div class="time-tile">Level 3<strong><span id="level3Time">${level3Time}</span>s</strong></div>
    </div>
    <p class="helper">These are minimum recheck intervals after a level change. Time passing alone never raises assistance; editor evidence is required.</p>
</div>

<div class="card">
    <div class="card-title">Quick actions</div>

    <button class="hint-button" id="getHintButton">
        💡 Get Hint
    </button>

    <button class="hint-button" id="logicButton">🔎 &nbsp;Check Code Logic</button>

    <button class="hint-button" id="resetButton">
        🔄 Reset AI Coding Buddy
    </button>
    <button class="hint-button" id="setupButton">✓ &nbsp;Check Setup</button>
    <button class="hint-button" id="trainButton">🧠 &nbsp;Train from Labeled Sessions</button>
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
document.getElementById("interactiveButton").addEventListener("click", runInteractive);
document.getElementById("setupButton").addEventListener("click", checkSetup);
document.getElementById("trainButton").addEventListener("click", trainSessions);
document.getElementById("automaticButton").addEventListener("click", automatic);
document.getElementById("getHintButton").addEventListener("click", getHint);
document.getElementById("logicButton").addEventListener("click", checkLogic);
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
    vscode.postMessage({ command: "analyzeLogic" });
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
