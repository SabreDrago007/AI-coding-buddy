import * as vscode from "vscode";
import { spawn } from "child_process";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as fs from "fs/promises";

export interface SetupCheck {
    label: string;
    status: "ready" | "action" | "info";
    details: string;
}

export class SetupDiagnostics {
    async check(extensionPath: string): Promise<SetupCheck[]> {
        const config = vscode.workspace.getConfiguration("codingBuddy");
        const checks: SetupCheck[] = [];
        const pythonConfigured = config.get<string>("pythonPath", "").trim();
        const pythonCandidates = pythonConfigured
            ? [pythonConfigured]
            : process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];

        let pythonCheck: SetupCheck = {
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

        checks.push(await this.compilerCheck("Java JDK", config.get<string>("javaCompilerPath", "javac"), ["-version"], "Install a JDK or update AI Coding Buddy: Java Compiler Path."));
        checks.push(await this.compilerCheck("Java runtime", config.get<string>("javaRuntimePath", "java"), ["-version"], "Install a JDK or update AI Coding Buddy: Java Runtime Path."));
        checks.push(await this.compilerCheck("C compiler", config.get<string>("cCompilerPath", "gcc"), ["--version"], "Install GCC or Clang, or update AI Coding Buddy: C Compiler Path."));
        checks.push(await this.compilerCheck("C++ compiler", config.get<string>("cppCompilerPath", "g++"), ["--version"], "Install G++ or Clang++, or update AI Coding Buddy: Cpp Compiler Path."));
        checks.push(await this.ollamaCheck(
            config.get<string>("ollamaUrl", "http://127.0.0.1:11434/api/generate"),
            config.get<string>("ollamaModel", "qwen2.5-coder:7b")
        ));
        checks.push({
            label: "Interactive execution",
            status: "info",
            details: "Programs run in a VS Code terminal and inherit your account permissions. Review code before running it; use the bounded Run Current File action when interactive input is not needed."
        });
        return checks;
    }

    private async compilerCheck(
        label: string,
        executable: string,
        args: string[],
        help: string
    ): Promise<SetupCheck> {
        const result = await this.run(executable, args);
        return {
            label,
            status: result.success ? "ready" : "action",
            details: result.success ? result.output.split(/\r?\n/)[0] || `${executable} is available.` : help
        };
    }

    private async ollamaCheck(configuredUrl: string, model: string): Promise<SetupCheck> {
        let endpoint: URL;
        try {
            endpoint = new URL(configuredUrl);
        } catch {
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
        const response = await new Promise<{ statusCode?: number; body: string }>(resolve => {
            const requestModule = tagsUrl.protocol === "https:" ? https : http;
            const request = requestModule.get(tagsUrl, response => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk: string) => {
                    if (body.length < 100_000) body += chunk.slice(0, 100_000 - body.length);
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
            const data = JSON.parse(response.body) as { models?: Array<{ name?: string }> };
            const found = data.models?.some(item => item.name === model || item.name?.startsWith(`${model}:`));
            return found
                ? { label: "Ollama model", status: "ready", details: `${model} is available at ${endpoint.host}.` }
                : { label: "Ollama model", status: "action", details: "Ollama is running, but " + model + " is not downloaded. Run `ollama pull " + model + "`." };
        } catch {
            return { label: "Ollama model", status: "action", details: "Ollama returned an unreadable model list." };
        }
    }

    private run(executable: string, args: string[]): Promise<{ success: boolean; output: string }> {
        return new Promise(resolve => {
            let output = "";
            let settled = false;
            const child = spawn(executable, args, { windowsHide: true });
            const timer = setTimeout(() => child.kill(), 5000);
            const finish = (success: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ success, output: output.trim() });
            };
            const append = (chunk: Buffer | string) => {
                if (output.length < 4000) output += chunk.toString().slice(0, 4000 - output.length);
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
