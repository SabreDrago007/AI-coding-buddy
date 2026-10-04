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
