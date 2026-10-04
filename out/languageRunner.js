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
exports.LanguageRunner = void 0;
exports.languageFromDocument = languageFromDocument;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
function languageFromDocument(languageId) {
    switch (languageId.toLowerCase()) {
        case "python": return "python";
        case "java": return "java";
        case "c": return "c";
        case "cpp": return "cpp";
        default: return undefined;
    }
}
class LanguageRunner {
    async run(sourcePath, language, storagePath) {
        const folder = path.dirname(sourcePath);
        const config = vscode.workspace.getConfiguration("codingBuddy");
        if (language === "python") {
            const configured = config.get("pythonPath", "").trim();
            const candidates = configured
                ? [configured]
                : process.platform === "win32"
                    ? ["py", "python", "python3"]
                    : ["python3", "python"];
            return this.tryRuntimes(candidates, sourcePath, folder);
        }
        if (language === "java") {
            const compiler = config.get("javaCompilerPath", "javac").trim();
            const runtime = config.get("javaRuntimePath", "java").trim();
            const buildPath = path.join(storagePath, "build", `java-${Date.now()}`);
            await fs.mkdir(buildPath, { recursive: true });
            try {
                const compile = await this.execute(compiler, ["-d", buildPath, "-sourcepath", folder, sourcePath], folder);
                if (!compile.success) {
                    return compile;
                }
                const source = await fs.readFile(sourcePath, "utf8");
                const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
                const className = path.basename(sourcePath, path.extname(sourcePath));
                const qualifiedName = packageName ? `${packageName}.${className}` : className;
                return await this.execute(runtime, ["-cp", buildPath, qualifiedName], folder);
            }
            finally {
                await fs.rm(buildPath, { recursive: true, force: true }).catch(() => undefined);
            }
        }
        await fs.mkdir(path.join(storagePath, "build"), { recursive: true });
        const isWindows = process.platform === "win32";
        const outputPath = path.join(storagePath, "build", `${path.basename(sourcePath, path.extname(sourcePath))}-${Date.now()}${isWindows ? ".exe" : ""}`);
        const compilerSetting = language === "c" ? "cCompilerPath" : "cppCompilerPath";
        const defaultCompiler = language === "c" ? "gcc" : "g++";
        const compiler = config.get(compilerSetting, defaultCompiler).trim();
        const compile = await this.execute(compiler, [sourcePath, "-o", outputPath], folder);
        if (!compile.success) {
            return compile;
        }
        try {
            return await this.execute(outputPath, [], folder);
        }
        finally {
            await fs.rm(outputPath, { force: true }).catch(() => undefined);
        }
    }
    async tryRuntimes(candidates, scriptPath, cwd) {
        for (const executable of candidates) {
            const result = await this.execute(executable, [scriptPath], cwd);
            if (!result.output.startsWith("__NOT_FOUND__")) {
                return result;
            }
        }
        return {
            success: false,
            output: "Python was not found. Install Python 3 or set AI Coding Buddy › Python Path in Settings."
        };
    }
    execute(executable, args, cwd) {
        return new Promise(resolve => {
            let output = "";
            let settled = false;
            let timedOut = false;
            const child = (0, child_process_1.spawn)(executable, args, { cwd, windowsHide: true });
            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, 120_000);
            const finish = (result) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                resolve(result);
            };
            const append = (chunk) => {
                if (output.length < 1_000_000) {
                    output += chunk.toString().slice(0, 1_000_000 - output.length);
                }
            };
            child.stdout.on("data", append);
            child.stderr.on("data", append);
            child.on("error", error => {
                finish({ success: false, output: `__NOT_FOUND__${error.message}` });
            });
            child.on("close", code => {
                if (timedOut) {
                    append("\nProcess stopped after the 120-second time limit.");
                }
                finish({ success: !timedOut && code === 0, output: output.trim() });
            });
            child.stdin.on("error", () => undefined);
            // This runner is intentionally non-interactive; close stdin so programs
            // waiting for input fail clearly instead of hanging until the timeout.
            child.stdin.end();
        });
    }
}
exports.LanguageRunner = LanguageRunner;
