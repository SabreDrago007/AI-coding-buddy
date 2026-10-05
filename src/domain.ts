export interface BehaviorFeatures {
    idle_seconds: number;
    errors: number;
    failed_runs: number;
    deletions: number;
    rapid_edits: number;
}

export type CodingLanguage = "python" | "java" | "c" | "cpp";

export function isAssistanceLevel(value: unknown): value is 1 | 2 | 3 {
    return value === 1 || value === 2 || value === 3;
}

export function isCodingLanguage(value: unknown): value is "auto" | CodingLanguage {
    return value === "auto" || value === "python" || value === "java" ||
        value === "c" || value === "cpp";
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

export function predictWithRules(features: BehaviorFeatures): number {
    if (
        features.failed_runs >= 4 || features.errors >= 7 ||
        features.idle_seconds >= 90 || features.deletions >= 16
    ) {
        return 3;
    }
    if (
        features.failed_runs >= 1 || features.errors >= 2 ||
        features.idle_seconds >= 35 || features.deletions >= 6 ||
        features.rapid_edits >= 5
    ) {
        return 2;
    }
    return 1;
}

export function nextAutomaticLevel(
    currentLevel: number,
    predictedLevel: number,
    elapsedSeconds: number,
    waitSeconds: number
): number {
    if (predictedLevel < currentLevel) return predictedLevel;
    if (predictedLevel === currentLevel || elapsedSeconds < waitSeconds) {
        return currentLevel;
    }
    return Math.min(currentLevel + 1, 3);
}

export function sampleHintSource(code: string, maxLength: number): string {
    const limit = Math.max(1, Math.floor(maxLength));
    if (code.length <= limit) return code;
    const marker = "\n/* middle of file omitted */\n";
    const available = Math.max(0, limit - marker.length);
    const headLength = Math.floor(available * 0.65);
    const tailLength = available - headLength;
    return `${code.slice(0, headLength)}${marker}${code.slice(-tailLength)}`;
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Conservative guard for Level 2: reject code, prescriptions, and answer-shaped prose. */
export function isSafeLevel2Response(response: string): boolean {
    const text = response.trim();
    if (!text || text.length > 600 || /```|~~~|`[^`]+`/.test(text)) return false;
    if ((text.match(/[.!?](?:\s|$)/g) ?? []).length > 3) return false;

    const answerShapedPatterns: RegExp[] = [
        /\b(?:the answer|solution|fix|correction) is\b/i,
        /\b(?:change|replace|set|assign|write|return)\b.{0,100}\b(?:to|with|as)\b/i,
        /\buse\s+(?:this|the following|exactly)\b/i,
        /\b(?:instead of|rather than)\b/i,
        /\b(?:correct|fixed)\s+(?:line|version|code)\b/i,
        /\b(?:should|needs? to|must)\s+(?:be|return|equal|contain|use|call|set)\b/i,
        /\b(?:put|insert|add)\b.{0,70}\b(?:before|after|inside|above|below)\b/i,
        /\b(?:0|1|true|false|null|none)\s+(?:is|should be|must be)\s+the\s+(?:output|answer|result)\b/i,
        /(?:===|==|!=|<=|>=|=>|:=|\+=|-=|\*=|\/=|\*\*|\b\w+\s*=\s*\w+)/
    ];
    if (answerShapedPatterns.some(pattern => pattern.test(text))) return false;

    const codeLikePatterns: RegExp[] = [
        /^\s*(?:print|console\.log|return|def|function|for|while|if|import|from|class)\b/m,
        /^\s*(?:const|let|var)\s+\w+\s*=/m,
        /\b\w+\([^\n)]*\)\s*(?:\{|;|=>)/,
        /\b(?:int|float|double|string|bool|char)\s+\w+\s*[=;(]/i
    ];
    return !codeLikePatterns.some(pattern => pattern.test(text));
}
