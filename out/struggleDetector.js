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
class StruggleDetector {
    features = {
        idle_seconds: 0,
        errors: 0,
        failed_runs: 0,
        deletions: 0,
        rapid_edits: 0
    };
    lastEditTime = Date.now();
    idleTimer;
    knownErrors = new Set();
    constructor() {
        this.idleTimer = setInterval(() => {
            this.features.idle_seconds =
                Math.floor((Date.now() - this.lastEditTime) / 1000);
        }, 1000);
    }
    recordEdit(deletedCharacters = 0) {
        const now = Date.now();
        const timeSinceLastEdit = now - this.lastEditTime;
        this.lastEditTime = now;
        this.features.idle_seconds = 0;
        if (deletedCharacters > 0) {
            this.features.deletions +=
                deletedCharacters;
        }
        if (timeSinceLastEdit < 1000) {
            this.features.rapid_edits++;
        }
    }
    recordError(errorKey) {
        if (errorKey) {
            if (this.knownErrors.has(errorKey)) {
                return;
            }
            this.knownErrors.add(errorKey);
        }
        this.features.errors++;
        console.log(`AI Coding Buddy: New error detected. Total errors: ${this.features.errors}`);
    }
    recordFailedRun() {
        this.features.failed_runs++;
        console.log(`AI Coding Buddy: Failed run detected. Total failed runs: ${this.features.failed_runs}`);
    }
    getFeatures() {
        return {
            ...this.features
        };
    }
    async predictLevel() {
        return new Promise((resolve) => {
            const extension = vscode.extensions.all.find(ext => ext.packageJSON.name ===
                "ai-coding-buddy");
            if (!extension) {
                console.error("AI Coding Buddy extension not found.");
                resolve(1);
                return;
            }
            const scriptPath = path.join(extension.extensionPath, "ml", "predict.py");
            const python = (0, child_process_1.spawn)("py", [scriptPath]);
            let output = "";
            python.stdout.on("data", (data) => {
                output +=
                    data.toString();
            });
            python.stderr.on("data", (data) => {
                console.error("Python error:", data.toString());
            });
            python.on("error", (error) => {
                console.error("Failed to start Python:", error);
                resolve(1);
            });
            python.on("close", () => {
                const prediction = parseInt(output.trim());
                if (prediction === 1 ||
                    prediction === 2 ||
                    prediction === 3) {
                    resolve(prediction);
                }
                else {
                    console.error("Invalid Random Forest prediction:", output);
                    resolve(1);
                }
            });
            python.stdin.write(JSON.stringify(this.features));
            python.stdin.end();
        });
    }
    reset() {
        this.features = {
            idle_seconds: 0,
            errors: 0,
            failed_runs: 0,
            deletions: 0,
            rapid_edits: 0
        };
        this.knownErrors.clear();
        this.lastEditTime =
            Date.now();
    }
    dispose() {
        clearInterval(this.idleTimer);
    }
}
exports.StruggleDetector = StruggleDetector;
