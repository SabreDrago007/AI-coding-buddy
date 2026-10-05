import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import { BehaviorFeatures, predictWithRules } from "./domain";
export { BehaviorFeatures } from "./domain";

const FEATURE_WINDOW_MS = 5 * 60 * 1000;

export class StruggleDetector {
    private lastEditTime = Date.now();
    private readonly errorEvents = new Map<string, number>();
    private readonly failedRunEvents: number[] = [];
    private readonly deletionEvents: number[] = [];
    private readonly rapidEditEvents: number[] = [];
    private readonly deletionEventTimes: number[] = [];
    private readonly navigationEventTimes: number[] = [];
    private activeDocument = "";
    private activeLine = -1;
    private activeLineSince = Date.now();
    private lastNavigationAt = 0;
    private readonly recentLines: number[] = [];
    private mlUnavailable = false;
    private predictionInFlight: Promise<number> | undefined;

    constructor() {}

    recordEdit(deletedCharacters = 0): void {
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

    recordCursorMovement(documentKey: string, line: number): void {
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
        if (line === this.activeLine) return;

        const revisited = this.recentLines.slice(-6).includes(line);
        const rapid = now - this.lastNavigationAt <= 1800;
        const largeJump = Math.abs(line - this.activeLine) >= 3;
        if (rapid && (largeJump || revisited)) this.navigationEventTimes.push(now);
        this.activeLine = line;
        this.activeLineSince = now;
        this.lastNavigationAt = now;
        this.recentLines.push(line);
        if (this.recentLines.length > 8) this.recentLines.shift();
    }

    recordError(errorKey?: string): void {
        const now = Date.now();
        if (errorKey) {
            const lastSeen = this.errorEvents.get(errorKey);
            if (lastSeen !== undefined && now - lastSeen < FEATURE_WINDOW_MS) {
                return;
            }
            this.errorEvents.set(errorKey, now);
        } else {
            this.errorEvents.set(`unkeyed-${now}-${Math.random()}`, now);
        }
    }

    recordFailedRun(): void {
        this.failedRunEvents.push(Date.now());
    }

    getFeatures(): BehaviorFeatures {
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

    async predictLevel(): Promise<number> {
        if (this.mlUnavailable) {
            return predictWithRules(this.getFeatures());
        }
        if (this.predictionInFlight) {
            return this.predictionInFlight;
        }
        this.predictionInFlight = this.predictWithModel().finally(() => {
            this.predictionInFlight = undefined;
        });
        return this.predictionInFlight;
    }

    private async predictWithModel(): Promise<number> {
        const extension = vscode.extensions.all.find(
            ext => ext.packageJSON.name === "ai-coding-buddy"
        );
        if (!extension) {
            return this.fallbackToRules("The extension model files could not be located.");
        }

        const scriptPath = path.join(extension.extensionPath, "ml", "predict.py");
        const configuredPath = vscode.workspace
            .getConfiguration("codingBuddy")
            .get<string>("pythonPath", "").trim();
        const candidates = configuredPath
            ? [configuredPath]
            : process.platform === "win32"
                ? ["py", "python", "python3"]
                : ["python3", "python"];

        for (const executable of candidates) {
            const modelPath = vscode.workspace.getConfiguration("codingBuddy").get<string>("modelPath", "").trim();
            const prediction = await this.runPrediction(executable, scriptPath, modelPath);
            if (prediction !== undefined) {
                return Math.max(prediction, predictWithRules(this.getFeatures()));
            }
        }
        return this.fallbackToRules(
            "Python or the model dependencies are unavailable. Configure Python and install requirements.txt to use the Random Forest."
        );
    }

    private runPrediction(executable: string, scriptPath: string, modelPath: string): Promise<number | undefined> {
        return new Promise(resolve => {
            let output = "";
            let spawnFailed = false;
            const env = { ...process.env };
            if (modelPath) env.CODING_BUDDY_MODEL_PATH = modelPath;
            const python = spawn(executable, [scriptPath], { windowsHide: true, env });
            python.stdout.setEncoding("utf8");
            python.stdout.on("data", (chunk: string) => output += chunk);
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

    private fallbackToRules(reason: string): number {
        this.mlUnavailable = true;
        console.warn(`AI Coding Buddy: ${reason}`);
        void vscode.window.showWarningMessage(
            `AI Coding Buddy is using its built-in struggle estimate. ${reason}`
        );
        return predictWithRules(this.getFeatures());
    }

    reset(): void {
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

    dispose(): void {
        // The detector owns no background resources.
    }

    private pruneEvents(cutoff: number): void {
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

    private pruneTimes(events: number[], cutoff: number): void {
        while (events.length > 0 && events[0] < cutoff) {
            events.shift();
        }
    }
}
