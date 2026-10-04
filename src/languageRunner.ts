import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import * as vscode from "vscode";

export type CodingLanguage = "python" | "java" | "c" | "cpp";

export interface RunResult {
    success: boolean;
    output: string;
}

export function languageFromDocument(languageId: string): CodingLanguage | undefined {
    switch (languageId.toLowerCase()) {
        case "python": return "python";
        case "java": return "java";
        case "c": return "c";
        case "cpp": return "cpp";
        default: return undefined;
    }
}

export class LanguageRunner {
    async run(
        sourcePath: string,
        language: CodingLanguage,
        storagePath: string
    ): Promise<RunResult> {
        const folder = path.dirname(sourcePath);
        const config = vscode.workspace.getConfiguration("codingBuddy");

        if (language === "python") {
            const configured = config.get<string>("pythonPath", "").trim();
            const candidates = configured
                ? [configured]
                : process.platform === "win32"
                    ? ["py", "python", "python3"]
                    : ["python3", "python"];
            return this.tryRuntimes(candidates, sourcePath, folder);
        }

        if (language === "java") {
            const compiler = config.get<string>("javaCompilerPath", "javac").trim();
            const runtime = config.get<string>("javaRuntimePath", "java").trim();
            const buildPath = path.join(storagePath, "build", `java-${Date.now()}`);
            await fs.mkdir(buildPath, { recursive: true });
            try {
                const compile = await this.execute(
                    compiler,
                    ["-d", buildPath, "-sourcepath", folder, sourcePath],
                    folder
                );
                if (!compile.success) {
                    return compile;
                }
                const source = await fs.readFile(sourcePath, "utf8");
                const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
                const className = path.basename(sourcePath, path.extname(sourcePath));
                const qualifiedName = packageName ? `${packageName}.${className}` : className;
                return await this.execute(runtime, ["-cp", buildPath, qualifiedName], folder);
            } finally {
                await fs.rm(buildPath, { recursive: true, force: true }).catch(() => undefined);
            }
        }

        await fs.mkdir(path.join(storagePath, "build"), { recursive: true });
        const isWindows = process.platform === "win32";
        const outputPath = path.join(
            storagePath,
            "build",
            `${path.basename(sourcePath, path.extname(sourcePath))}-${Date.now()}${isWindows ? ".exe" : ""}`
        );
        const compilerSetting = language === "c" ? "cCompilerPath" : "cppCompilerPath";
        const defaultCompiler = language === "c" ? "gcc" : "g++";
        const compiler = config.get<string>(compilerSetting, defaultCompiler).trim();
        const compile = await this.execute(compiler, [sourcePath, "-o", outputPath], folder);
        if (!compile.success) {
            return compile;
        }
        try {
            return await this.execute(outputPath, [], folder);
        } finally {
            await fs.rm(outputPath, { force: true }).catch(() => undefined);
        }
    }

    private async tryRuntimes(
        candidates: string[],
        scriptPath: string,
        cwd: string
    ): Promise<RunResult> {
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

    private execute(executable: string, args: string[], cwd: string): Promise<RunResult> {
        return new Promise(resolve => {
            let output = "";
            let settled = false;
            let timedOut = false;
            const child = spawn(executable, args, { cwd, windowsHide: true });
            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, 120_000);
            const finish = (result: RunResult) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(result);
            };
            const append = (chunk: Buffer | string) => {
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
