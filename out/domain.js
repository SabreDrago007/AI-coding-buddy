"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAssistanceLevel = isAssistanceLevel;
exports.isCodingLanguage = isCodingLanguage;
exports.languageFromDocument = languageFromDocument;
exports.predictWithRules = predictWithRules;
exports.nextAutomaticLevel = nextAutomaticLevel;
exports.sampleHintSource = sampleHintSource;
exports.escapeHtml = escapeHtml;
exports.isSafeLevel2Response = isSafeLevel2Response;
function isAssistanceLevel(value) {
    return value === 1 || value === 2 || value === 3;
}
function isCodingLanguage(value) {
    return value === "auto" || value === "python" || value === "java" ||
        value === "c" || value === "cpp";
}
function languageFromDocument(languageId) {
    switch (languageId.toLowerCase()) {
        case "python": return "python";
        case "java": return "java";
        case "c": return "c";
        case "cpp": return "cpp";
        default: return undefined;
    }
}
function predictWithRules(features) {
    if (features.failed_runs >= 4 || features.errors >= 7 ||
        features.idle_seconds >= 90 || features.deletions >= 16) {
        return 3;
    }
    if (features.failed_runs >= 1 || features.errors >= 2 ||
        features.idle_seconds >= 35 || features.deletions >= 6 ||
        features.rapid_edits >= 5) {
        return 2;
    }
    return 1;
}
function nextAutomaticLevel(currentLevel, predictedLevel, elapsedSeconds, waitSeconds) {
    if (predictedLevel < currentLevel)
        return predictedLevel;
    if (predictedLevel === currentLevel || elapsedSeconds < waitSeconds) {
        return currentLevel;
    }
    return Math.min(currentLevel + 1, 3);
}
function sampleHintSource(code, maxLength) {
    const limit = Math.max(1, Math.floor(maxLength));
    if (code.length <= limit)
        return code;
    const marker = "\n/* middle of file omitted */\n";
    const available = Math.max(0, limit - marker.length);
    const headLength = Math.floor(available * 0.65);
    const tailLength = available - headLength;
    return `${code.slice(0, headLength)}${marker}${code.slice(-tailLength)}`;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
/** Conservative guard for Level 2: reject code, prescriptions, and answer-shaped prose. */
function isSafeLevel2Response(response) {
    const text = response.trim();
    if (!text || text.length > 600 || /```|~~~|`[^`]+`/.test(text))
        return false;
    if ((text.match(/[.!?](?:\s|$)/g) ?? []).length > 3)
        return false;
    const answerShapedPatterns = [
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
    if (answerShapedPatterns.some(pattern => pattern.test(text)))
        return false;
    const codeLikePatterns = [
        /^\s*(?:print|console\.log|return|def|function|for|while|if|import|from|class)\b/m,
        /^\s*(?:const|let|var)\s+\w+\s*=/m,
        /\b\w+\([^\n)]*\)\s*(?:\{|;|=>)/,
        /\b(?:int|float|double|string|bool|char)\s+\w+\s*[=;(]/i
    ];
    return !codeLikePatterns.some(pattern => pattern.test(text));
}
