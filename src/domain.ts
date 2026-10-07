export interface BehaviorFeatures {
    idle_seconds: number;
    errors: number;
    failed_runs: number;
    deletions: number;
    rapid_edits: number;
    stuck_line_seconds?: number;
    deletion_bursts?: number;
    navigation_bursts?: number;
    logic_concerns?: number;
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
    const stuck = features.stuck_line_seconds ?? 0;
    const deletionBursts = features.deletion_bursts ?? 0;
    const navigationBursts = features.navigation_bursts ?? 0;
    const logicConcerns = features.logic_concerns ?? 0;
    if (
        features.failed_runs >= 4 || features.errors >= 7 ||
        features.deletions >= 16 || deletionBursts >= 8 ||
        (stuck >= 90 && (features.errors >= 2 || deletionBursts >= 4 || navigationBursts >= 5)) ||
        (logicConcerns >= 3 && (features.errors >= 2 || deletionBursts >= 3 || features.failed_runs >= 1))
    ) {
        return 3;
    }
    if (
        features.failed_runs >= 1 || features.errors >= 2 ||
        features.deletions >= 6 || deletionBursts >= 3 ||
        features.rapid_edits >= 5 || navigationBursts >= 6 ||
        (stuck >= 45 && (features.errors >= 1 || deletionBursts >= 2 || navigationBursts >= 3)) ||
        logicConcerns >= 1
    ) {
        return 2;
    }
    return 1;
}

export function nextAutomaticLevel(
    currentLevel: number,
    predictedLevel: number,
    elapsedSeconds: number,
    waitSeconds: number,
    hasStruggleEvidence = false
): number {
    if (predictedLevel < currentLevel) return predictedLevel;
    if (predictedLevel === currentLevel || elapsedSeconds < waitSeconds || !hasStruggleEvidence) {
        return currentLevel;
    }
    return Math.min(currentLevel + 1, 3);
}

export function hasStruggleEvidence(features: BehaviorFeatures, targetLevel: number): boolean {
    const stuck = features.stuck_line_seconds ?? 0;
    const deletionBursts = features.deletion_bursts ?? 0;
    const navigationBursts = features.navigation_bursts ?? 0;
    const logicConcerns = features.logic_concerns ?? 0;
    if (targetLevel >= 3) {
        return features.failed_runs >= 2 || features.errors >= 5 || features.deletions >= 12 ||
            deletionBursts >= 6 || (stuck >= 90 && (features.errors >= 1 || deletionBursts >= 3 || navigationBursts >= 4)) ||
            (logicConcerns >= 3 && (features.errors >= 2 || deletionBursts >= 3 || features.failed_runs >= 1));
    }
    return features.failed_runs >= 1 || features.errors >= 2 || features.deletions >= 6 ||
        features.rapid_edits >= 5 || deletionBursts >= 3 || navigationBursts >= 6 ||
        (stuck >= 45 && (features.errors >= 1 || deletionBursts >= 2 || navigationBursts >= 3)) ||
        logicConcerns >= 1;
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

/** Adds stable editor line references for Level 3 edits, preserving gaps when a long file is sampled. */
export function numberHintSourceLines(code: string, maxLength: number, lineOffset = 0): string {
    const lines = code.split("\n");
    const width = String(lineOffset + lines.length).length;
    const numbered = lines.map((line, index) => `${String(lineOffset + index + 1).padStart(width, " ")} | ${line}`);
    const full = numbered.join("\n");
    const limit = Math.max(1, Math.floor(maxLength));
    if (full.length <= limit) return full;

    const marker = (first: number, last: number) => `... [source lines ${first}-${last} omitted] ...`;
    const head: string[] = [];
    const tail: string[] = [];
    let headLength = 0;
    let tailLength = 0;
    let firstTail = numbered.length;
    const budget = Math.max(1, limit - 100);
    while (head.length < numbered.length && headLength + numbered[head.length].length + 1 <= budget * 0.6) {
        headLength += numbered[head.length].length + 1;
        head.push(numbered[head.length]);
    }
    while (firstTail > head.length && tailLength + numbered[firstTail - 1].length + 1 <= budget * 0.4) {
        firstTail--;
        tailLength += numbered[firstTail].length + 1;
        tail.unshift(numbered[firstTail]);
    }
    if (firstTail <= head.length) return `${head.join("\n")}\n... [remaining source omitted] ...`;
    return `${head.join("\n")}\n${marker(lineOffset + head.length + 1, lineOffset + firstTail)}\n${tail.join("\n")}`;
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

