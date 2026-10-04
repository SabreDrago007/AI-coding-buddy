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
exports.HintEngine = void 0;
const http = __importStar(require("http"));
const vscode = __importStar(require("vscode"));
class HintEngine {
    async generateHint(level, code, language) {
        const settings = vscode.workspace.getConfiguration("codingBuddy");
        const sourceLimit = settings.get("maxHintSourceLength", 20000);
        const hintCode = code.length > sourceLimit
            ? `${code.slice(0, Math.floor(sourceLimit * 0.65))}\n\n/* middle of file omitted */\n\n${code.slice(-Math.floor(sourceLimit * 0.35))}`
            : code;
        if (level === 2) {
            return this.generateLevel2Hint(hintCode, language);
        }
        const prompt = this.buildPrompt(level, hintCode, language);
        return this.callOllama(prompt, level);
    }
    // LEVEL 2: Strong guidance without revealing the solution.
    async generateLevel2Hint(code, language) {
        const prompt = `
You are AI Coding Buddy, a programming tutor.

Assistance level: 2
Programming language: ${language}

Student's code:
<student_code>
${code}
</student_code>

Help the student discover the answer independently.

Rules:
- Give a specific conceptual hint about what to investigate.
- Explain the relevant logic in plain English.
- Do not provide executable code or code snippets.
- Do not reveal the exact correction.
- Do not rewrite the student's code.
- Do not provide the complete solution.
- Do not invent errors if the code is correct.
- If the code looks correct, suggest a useful test.
- Keep the answer to 2-3 sentences.

Return only the hint.
`;
        const response = await this.callOllama(prompt, 2);
        if (this.isSafeLevel2Response(response)) {
            return response;
        }
        return this.getLevel2Fallback();
    }
    // Reject common direct answers and code snippets.
    isSafeLevel2Response(response) {
        const text = response.trim();
        if (!text || text.length > 700) {
            return false;
        }
        if (/```|~~~|`[^`]+`/.test(text)) {
            return false;
        }
        const forbiddenPatterns = [
            /\binstead of\b/i,
            /\bshould be\b/i,
            /\bchange\b.{0,100}\bto\b/i,
            /\breplace\b/i,
            /\bcorrect(?:ed|ion)?\b/i,
            /\bthe answer is\b/i,
            /\bthe solution is\b/i,
            /\bthe fix is\b/i,
            /\bfix that\b/i,
            /\buse\s+this\b/i,
            /\bwrite\s+this\b/i,
            /\btypo\b/i,
            /\bset\s+\w+\s*=/i,
            /\bassign\s+\w+\s*=/i,
            /\bcorrect\s+line\b/i
        ];
        if (forbiddenPatterns.some((pattern) => pattern.test(text))) {
            return false;
        }
        const codeLikePatterns = [
            /^\s*print\s*\(/m,
            /^\s*console\.log\s*\(/m,
            /^\s*return\s+/m,
            /^\s*def\s+\w+\s*\(/m,
            /^\s*function\s+\w+\s*\(/m,
            /^\s*for\s*\(/m,
            /^\s*for\s+\w+\s+in\s+/m,
            /^\s*if\s+.+:/m,
            /^\s*while\s+.+:/m,
            /^\s*import\s+\w+/m,
            /^\s*(?:const|let|var)\s+\w+\s*=/m
        ];
        return !codeLikePatterns.some((pattern) => pattern.test(text));
    }
    getLevel2Fallback() {
        return ("Trace your program step by step using a small example. " +
            "Check how each variable changes and whether the program's " +
            "logic matches the expected result. At which step does the " +
            "actual behavior first differ from what you expected?");
    }
    buildPrompt(level, code, language) {
        if (level === 1) {
            return `
You are AI Coding Buddy, a programming tutor.

Language: ${language}

Student's code:
<student_code>
${code}
</student_code>

Give one subtle conceptual hint.

Rules:
- Do not identify the exact bug.
- Do not provide code or pseudocode.
- Do not give the solution.
- Ask a guiding question when useful.
- Keep the answer to 1-2 sentences.
- If the code is correct, suggest something to test.

Return only the hint.
`;
        }
        // LEVEL 3: Direct help, with a concise response.
        return `
You are AI Coding Buddy, a programming assistant.

Language: ${language}

Student's code:
<student_code>
${code}
</student_code>

Give Level 3 assistance.

Rules:
- Identify the main problem, if one exists.
- Provide corrected code when necessary.
- Briefly explain why the correction works.
- If the code is correct, explain its behavior.
- Avoid lengthy introductions.
- Keep the answer concise.

Return the answer directly.
`;
    }
    callOllama(prompt, level) {
        return new Promise((resolve, reject) => {
            const settings = vscode.workspace.getConfiguration("codingBuddy");
            const ollamaUrl = settings.get("ollamaUrl", "http://127.0.0.1:11434/api/generate");
            const model = settings.get("ollamaModel", "qwen2.5-coder:7b");
            const timeoutMs = settings.get("hintTimeoutMs", 120000);
            const requestBody = JSON.stringify({
                model,
                prompt,
                stream: false,
                keep_alive: "10m",
                options: {
                    temperature: 0.1,
                    num_predict: level === 1 ? 80 :
                        level === 2 ? 120 : 250
                }
            });
            const request = http.request(new URL(ollamaUrl), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(requestBody)
                },
                timeout: timeoutMs
            }, (response) => {
                let data = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                    if (data.length < 2_000_000) {
                        data += chunk.slice(0, 2_000_000 - data.length);
                    }
                });
                response.on("end", () => {
                    if (response.statusCode === undefined ||
                        response.statusCode < 200 ||
                        response.statusCode >= 300) {
                        reject(new Error(`Ollama returned HTTP ${response.statusCode ?? "unknown"}. Check that Ollama is running.`));
                        return;
                    }
                    try {
                        const result = JSON.parse(data);
                        if (result.error) {
                            reject(new Error(result.error));
                            return;
                        }
                        const answer = result.response?.trim();
                        if (!answer) {
                            reject(new Error("Ollama returned an empty response."));
                            return;
                        }
                        resolve(answer);
                    }
                    catch {
                        reject(new Error("Could not parse the response from Ollama."));
                    }
                });
            });
            request.on("timeout", () => {
                request.destroy(new Error(`Hint generation timed out after ${Math.round(timeoutMs / 1000)} seconds. Please try again.`));
            });
            request.on("error", (error) => {
                reject(new Error(`Could not connect to Ollama at ${ollamaUrl}. ` +
                    `Make sure Ollama is running. Details: ${error.message}`));
            });
            request.write(requestBody);
            request.end();
        });
    }
}
exports.HintEngine = HintEngine;
