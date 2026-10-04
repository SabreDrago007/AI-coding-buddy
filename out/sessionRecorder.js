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
exports.SessionRecorder = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class SessionRecorder {
    activeSession;
    dataPath;
    constructor(storagePath) {
        this.dataPath = path.join(storagePath, "learning_sessions.csv");
    }
    get isActive() {
        return this.activeSession !== undefined;
    }
    start(predictedLevel) {
        this.activeSession = {
            startedAt: Date.now(),
            predictedLevel,
            manualLevel: null,
            hintRequests: 0,
            requestedStrongerHint: false,
            attempts: 0
        };
    }
    recordManualLevel(level) {
        if (this.activeSession) {
            this.activeSession.manualLevel = level;
        }
    }
    recordHint(level) {
        if (!this.activeSession) {
            return;
        }
        this.activeSession.hintRequests++;
        if (this.activeSession.manualLevel !== null &&
            this.activeSession.manualLevel > this.activeSession.predictedLevel &&
            level === this.activeSession.manualLevel) {
            this.activeSession.requestedStrongerHint = true;
        }
    }
    recordAttempt() {
        if (this.activeSession) {
            this.activeSession.attempts++;
        }
    }
    async finish(solved, features) {
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
        const needsHeader = await fs.access(this.dataPath).then(() => false, () => true);
        if (needsHeader) {
            await fs.writeFile(this.dataPath, `${header.join(",")}\n`, "utf8");
        }
        await fs.appendFile(this.dataPath, `${row}\n`, "utf8");
    }
}
exports.SessionRecorder = SessionRecorder;
