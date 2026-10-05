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
exports.StruggleDetector = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const domain_1 = require("./domain");
const FEATURE_WINDOW_MS = 5 * 60 * 1000;
class StruggleDetector {
    lastEditTime = Date.now();
    errorEvents = new Map();
    failedRunEvents = [];
    deletionEvents = [];
    rapidEditEvents = [];
    deletionEventTimes = [];
    navigationEventTimes = [];
    activeDocument = "";
    activeLine = -1;
    activeLineSince = Date.now();
    lastNavigationAt = 0;
    recentLines = [];
    mlUnavailable = false;
    predictionInFlight;
    constructor() { }
    recordEdit(deletedCharacters = 0) {
        const now = Date.now();
        const timeSinceLastEdit = now - this.lastEditTime;
        this.lastEditTime = now;
        if (deletedCharacters > 0) {
            // The training feature represents deletion operations, not characters.
            this.deletionEvents.push(now);
            this.deletionEventTimes.push(now);
        }
        if (timeSinceLastEdit < 1000) {
            this.rapidEditEvents.push(now);
        }
    }
    recordCursorMovement(documentKey, line) {
        const now = Date.now();
        if (documentKey !== this.activeDocument) {
            this.activeDocument = documentKey;
            this.activeLine = line;
            this.activeLineSince = now;
            this.lastNavigationAt = now;
            this.recentLines.length = 0;
            this.recentLines.push(line);
            return;
        }
        if (line === this.activeLine)
            return;
        const revisited = this.recentLines.slice(-6).includes(line);
        const rapid = now - this.lastNavigationAt <= 1800;
        const largeJump = Math.abs(line - this.activeLine) >= 3;
        if (rapid && (largeJump || revisited))
            this.navigationEventTimes.push(now);
        this.activeLine = line;
        this.activeLineSince = now;
        this.lastNavigationAt = now;
        this.recentLines.push(line);
        if (this.recentLines.length > 8)
            this.recentLines.shift();
    }
    recordError(errorKey) {
        const now = Date.now();
        if (errorKey) {
            const lastSeen = this.errorEvents.get(errorKey);
            if (lastSeen !== undefined && now - lastSeen < FEATURE_WINDOW_MS) {
                return;
            }
            this.errorEvents.set(errorKey, now);
        }
        else {
            this.errorEvents.set(`unkeyed-${now}-${Math.random()}`, now);
        }
    }
    recordFailedRun() {
        this.failedRunEvents.push(Date.now());
    }
    getFeatures() {
        const now = Date.now();
        const cutoff = now - FEATURE_WINDOW_MS;
        this.pruneEvents(cutoff);
        this.pruneTimes(this.deletionEventTimes, now - 15_000);
        this.pruneTimes(this.navigationEventTimes, now - 15_000);
        return {
            idle_seconds: Math.min(120, Math.floor((now - this.lastEditTime) / 1000)),
            errors: Math.min(this.errorEvents.size, 10),
            failed_runs: Math.min(this.failedRunEvents.length, 8),
            deletions: Math.min(this.deletionEvents.length, 20),
            rapid_edits: Math.min(this.rapidEditEvents.length, 15),
            stuck_line_seconds: Math.min(300, Math.floor((now - this.activeLineSince) / 1000)),
            deletion_bursts: Math.min(20, this.deletionEventTimes.length),
            navigation_bursts: Math.min(20, this.navigationEventTimes.length)
        };
    }
    async predictLevel() {
        if (this.mlUnavailable) {
            return (0, domain_1.predictWithRules)(this.getFeatures());
        }
        if (this.predictionInFlight) {
            return this.predictionInFlight;
        }
        this.predictionInFlight = this.predictWithModel().finally(() => {
            this.predictionInFlight = undefined;
        });
        return this.predictionInFlight;
    }
    async predictWithModel() {
        const extension = vscode.extensions.all.find(ext => ext.packageJSON.name === "ai-coding-buddy");
        if (!extension) {
            return this.fallbackToRules("The extension model files could not be located.");
        }
        const scriptPath = path.join(extension.extensionPath, "ml", "predict.py");
        const configuredPath = vscode.workspace
            .getConfiguration("codingBuddy")
            .get("pythonPath", "").trim();
        const candidates = configuredPath
            ? [configuredPath]
            : process.platform === "win32"
                ? ["py", "python", "python3"]
                : ["python3", "python"];
        for (const executable of candidates) {
            const modelPath = vscode.workspace.getConfiguration("codingBuddy").get("modelPath", "").trim();
            const prediction = await this.runPrediction(executable, scriptPath, modelPath);
            if (prediction !== undefined) {
                return Math.max(prediction, (0, domain_1.predictWithRules)(this.getFeatures()));
            }
        }
        return this.fallbackToRules("Python or the model dependencies are unavailable. Configure Python and install requirements.txt to use the Random Forest.");
    }
    runPrediction(executable, scriptPath, modelPath) {
        return new Promise(resolve => {
            let output = "";
            let spawnFailed = false;
            const env = { ...process.env };
            if (modelPath)
                env.CODING_BUDDY_MODEL_PATH = modelPath;
            const python = (0, child_process_1.spawn)(executable, [scriptPath], { windowsHide: true, env });
            python.stdout.setEncoding("utf8");
            python.stdout.on("data", (chunk) => output += chunk);
            python.on("error", () => {
                spawnFailed = true;
                resolve(undefined);
            });
            python.on("close", exitCode => {
                if (spawnFailed) {
                    return;
                }
                const prediction = Number.parseInt(output.trim(), 10);
                if (exitCode === 0 && [1, 2, 3].includes(prediction)) {
                    resolve(prediction);
                    return;
                }
                resolve(undefined);
            });
            python.stdin.on("error", () => undefined);
            python.stdin.end(JSON.stringify(this.getFeatures()));
        });
    }
    fallbackToRules(reason) {
        this.mlUnavailable = true;
        console.warn(`AI Coding Buddy: ${reason}`);
        void vscode.window.showWarningMessage(`AI Coding Buddy is using its built-in struggle estimate. ${reason}`);
        return (0, domain_1.predictWithRules)(this.getFeatures());
    }
    reset() {
        this.errorEvents.clear();
        this.failedRunEvents.length = 0;
        this.deletionEvents.length = 0;
        this.rapidEditEvents.length = 0;
        this.deletionEventTimes.length = 0;
        this.navigationEventTimes.length = 0;
        this.recentLines.length = 0;
        this.activeDocument = "";
        this.activeLine = -1;
        this.activeLineSince = Date.now();
        this.lastEditTime = Date.now();
    }
    dispose() {
        // The detector owns no background resources.
    }
    pruneEvents(cutoff) {
        for (const [key, time] of this.errorEvents) {
            if (time < cutoff) {
                this.errorEvents.delete(key);
            }
        }
        this.pruneTimes(this.failedRunEvents, cutoff);
        this.pruneTimes(this.deletionEvents, cutoff);
        this.pruneTimes(this.rapidEditEvents, cutoff);
        this.pruneTimes(this.deletionEventTimes, Date.now() - 15_000);
        this.pruneTimes(this.navigationEventTimes, Date.now() - 15_000);
    }
    pruneTimes(events, cutoff) {
        while (events.length > 0 && events[0] < cutoff) {
            events.shift();
        }
    }
}
exports.StruggleDetector = StruggleDetector;
