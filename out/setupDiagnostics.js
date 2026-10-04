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
exports.SetupDiagnostics = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
class SetupDiagnostics {
    async check(extensionPath) {
        const config = vscode.workspace.getConfiguration("codingBuddy");
        const checks = [];
        const pythonConfigured = config.get("pythonPath", "").trim();
        const pythonCandidates = pythonConfigured
            ? [pythonConfigured]
            : process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
        let pythonCheck = {
            label: "Python ML dependencies",
            status: "action",
            details: "Python with joblib, pandas, and scikit-learn was not found. The built-in rule estimate remains available."
        };
        for (const executable of pythonCandidates) {
            const result = await this.run(executable, [
                "-c",
                "import joblib, pandas, sklearn; print('Python ' + __import__('sys').version.split()[0] + ', scikit-learn ' + sklearn.__version__)"
            ]);
            if (result.success) {
                pythonCheck = {
                    label: "Python ML dependencies",
                    status: "ready",
                    details: `${executable}: ${result.output}`
                };
                break;
            }
        }
        checks.push(pythonCheck);
        const modelPath = path.join(extensionPath, "ml", "struggle_model.pkl");
        const modelExists = await fs.access(modelPath).then(() => true, () => false);
        checks.push({
            label: "Bundled struggle model",
            status: modelExists ? "ready" : "action",
            details: modelExists ? "Model file is included in this extension." : "Model file is missing from the extension package."
        });
        checks.push(await this.compilerCheck("Java JDK", config.get("javaCompilerPath", "javac"), ["-version"], "Install a JDK or update AI Coding Buddy: Java Compiler Path."));
        checks.push(await this.compilerCheck("Java runtime", config.get("javaRuntimePath", "java"), ["-version"], "Install a JDK or update AI Coding Buddy: Java Runtime Path."));
        checks.push(await this.compilerCheck("C compiler", config.get("cCompilerPath", "gcc"), ["--version"], "Install GCC or Clang, or update AI Coding Buddy: C Compiler Path."));
        checks.push(await this.compilerCheck("C++ compiler", config.get("cppCompilerPath", "g++"), ["--version"], "Install G++ or Clang++, or update AI Coding Buddy: Cpp Compiler Path."));
        checks.push(await this.ollamaCheck(config.get("ollamaUrl", "http://127.0.0.1:11434/api/generate"), config.get("ollamaModel", "qwen2.5-coder:7b")));
        checks.push({
            label: "Interactive execution",
            status: "info",
            details: "Programs run in a VS Code terminal and inherit your account permissions. Review code before running it; use the bounded Run Current File action when interactive input is not needed."
        });
        return checks;
    }
    async compilerCheck(label, executable, args, help) {
        const result = await this.run(executable, args);
        return {
            label,
            status: result.success ? "ready" : "action",
            details: result.success ? result.output.split(/\r?\n/)[0] || `${executable} is available.` : help
        };
    }
    async ollamaCheck(configuredUrl, model) {
        let endpoint;
        try {
            endpoint = new URL(configuredUrl);
        }
        catch {
            return { label: "Ollama model", status: "action", details: "The configured Ollama URL is invalid." };
        }
        const hostname = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
        const local = hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
        if (!local) {
            return { label: "Ollama model", status: "info", details: `Remote host ${endpoint.host} was not contacted by setup check.` };
        }
        if (!["http:", "https:"].includes(endpoint.protocol)) {
            return { label: "Ollama model", status: "action", details: "Use an HTTP or HTTPS Ollama URL." };
        }
        const tagsUrl = new URL("/api/tags", endpoint.origin);
        const response = await new Promise(resolve => {
            const requestModule = tagsUrl.protocol === "https:" ? https : http;
            const request = requestModule.get(tagsUrl, response => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                    if (body.length < 100_000)
                        body += chunk.slice(0, 100_000 - body.length);
                });
                response.on("end", () => resolve({ statusCode: response.statusCode, body }));
            });
            request.setTimeout(2500, () => request.destroy());
            request.on("error", () => resolve({ body: "" }));
        });
        if (response.statusCode !== 200) {
            return { label: "Ollama model", status: "action", details: "Ollama did not respond locally. Start Ollama and run `ollama pull <model>`." };
        }
        try {
            const data = JSON.parse(response.body);
            const found = data.models?.some(item => item.name === model || item.name?.startsWith(`${model}:`));
            return found
                ? { label: "Ollama model", status: "ready", details: `${model} is available at ${endpoint.host}.` }
                : { label: "Ollama model", status: "action", details: "Ollama is running, but " + model + " is not downloaded. Run `ollama pull " + model + "`." };
        }
        catch {
            return { label: "Ollama model", status: "action", details: "Ollama returned an unreadable model list." };
        }
    }
    run(executable, args) {
        return new Promise(resolve => {
            let output = "";
            let settled = false;
            const child = (0, child_process_1.spawn)(executable, args, { windowsHide: true });
            const timer = setTimeout(() => child.kill(), 5000);
            const finish = (success) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve({ success, output: output.trim() });
            };
            const append = (chunk) => {
                if (output.length < 4000)
                    output += chunk.toString().slice(0, 4000 - output.length);
            };
            child.stdout.on("data", append);
            child.stderr.on("data", append);
            child.on("error", () => finish(false));
            child.on("close", code => finish(code === 0));
            child.stdin.on("error", () => undefined);
            child.stdin.end();
        });
    }
}
exports.SetupDiagnostics = SetupDiagnostics;
