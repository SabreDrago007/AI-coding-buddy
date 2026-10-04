import * as fs from "fs/promises";
import * as path from "path";
import { BehaviorFeatures } from "./struggleDetector";

interface LearningSession {
    startedAt: number;
    predictedLevel: number;
    manualLevel: number | null;
    hintRequests: number;
    requestedStrongerHint: boolean;
    attempts: number;
}

export class SessionRecorder {
    private activeSession: LearningSession | undefined;
    private readonly dataPath: string;

    constructor(storagePath: string) {
        this.dataPath = path.join(storagePath, "learning_sessions.csv");
    }

    get isActive(): boolean {
        return this.activeSession !== undefined;
    }

    start(predictedLevel: number): void {
        this.activeSession = {
            startedAt: Date.now(),
            predictedLevel,
            manualLevel: null,
            hintRequests: 0,
            requestedStrongerHint: false,
            attempts: 0
        };
    }

    recordManualLevel(level: number): void {
        if (this.activeSession) {
            this.activeSession.manualLevel = level;
        }
    }

    recordHint(level: number): void {
        if (!this.activeSession) {
            return;
        }

        this.activeSession.hintRequests++;
        if (
            this.activeSession.manualLevel !== null &&
            this.activeSession.manualLevel > this.activeSession.predictedLevel &&
            level === this.activeSession.manualLevel
        ) {
            this.activeSession.requestedStrongerHint = true;
        }
    }

    recordAttempt(): void {
        if (this.activeSession) {
            this.activeSession.attempts++;
        }
    }

    async finish(solved: boolean, features: BehaviorFeatures): Promise<void> {
        const session = this.activeSession;
        if (!session) {
            return;
        }

        this.activeSession = undefined;
        const header = [
            "predicted_level", "manual_level", "requested_stronger_hint", "solved",
            "hint_requests", "time_to_fix_seconds", "attempts",
            "idle_seconds", "errors", "failed_runs", "deletions", "rapid_edits"
        ];
        const elapsedSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
        const row = [
            session.predictedLevel,
            session.manualLevel ?? "",
            session.requestedStrongerHint,
            solved,
            session.hintRequests,
            solved ? elapsedSeconds : "",
            session.attempts,
            features.idle_seconds,
            features.errors,
            features.failed_runs,
            features.deletions,
            features.rapid_edits
        ].join(",");

        await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
        const needsHeader = await fs.access(this.dataPath).then(
            () => false,
            () => true
        );
        if (needsHeader) {
            await fs.writeFile(this.dataPath, `${header.join(",")}\n`, "utf8");
        }
        await fs.appendFile(this.dataPath, `${row}\n`, "utf8");
    }
}
