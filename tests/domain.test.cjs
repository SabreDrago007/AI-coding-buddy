const test = require("node:test");
const assert = require("node:assert/strict");
const {
    escapeHtml,
    isAssistanceLevel,
    isCodingLanguage,
    isSafeLevel2Response,
    languageFromDocument,
    nextAutomaticLevel,
    predictWithRules,
    sampleHintSource
} = require("../out/domain.js");

test("accepts only supported assistance levels and languages", () => {
    assert.equal(isAssistanceLevel(2), true);
    assert.equal(isAssistanceLevel("2"), false);
    assert.equal(isCodingLanguage("cpp"), true);
    assert.equal(isCodingLanguage("javascript"), false);
    assert.equal(languageFromDocument("Python"), "python");
    assert.equal(languageFromDocument("plaintext"), undefined);
});

test("rule estimate maps low, medium and high struggle features", () => {
    const blank = { idle_seconds: 0, errors: 0, failed_runs: 0, deletions: 0, rapid_edits: 0 };
    assert.equal(predictWithRules(blank), 1);
    assert.equal(predictWithRules({ ...blank, failed_runs: 1 }), 2);
    assert.equal(predictWithRules({ ...blank, errors: 7 }), 3);
});

test("automatic level escalation waits, steps up one level, and lowers immediately", () => {
    assert.equal(nextAutomaticLevel(1, 3, 4, 10), 1);
    assert.equal(nextAutomaticLevel(1, 3, 10, 10), 2);
    assert.equal(nextAutomaticLevel(3, 1, 0, 10), 1);
    assert.equal(nextAutomaticLevel(3, 3, 100, 10), 3);
});

test("source sampling stays within its limit and preserves both ends", () => {
    const source = "START" + "x".repeat(500) + "END";
    const sample = sampleHintSource(source, 100);
    assert.ok(sample.length <= 100);
    assert.ok(sample.startsWith("START"));
    assert.ok(sample.endsWith("END"));
    assert.match(sample, /middle of file omitted/);
});

test("HTML escaping prevents markup and attribute injection", () => {
    assert.equal(escapeHtml(`<script x='"'>&`), "&lt;script x=&#39;&quot;&#39;&gt;&amp;");
});

test("Level 2 permits targeted reasoning hints but rejects answer leaks", () => {
    assert.equal(isSafeLevel2Response("Trace a small input and watch when the loop stops. Compare that point with the data length."), true);
    assert.equal(isSafeLevel2Response("The answer is 42; return 42 from the function."), false);
    assert.equal(isSafeLevel2Response("Change the condition to i < n."), false);
    assert.equal(isSafeLevel2Response("```python\nreturn total\n```"), false);
    assert.equal(isSafeLevel2Response("Look at how the boundary value is handled. Try a case at the edge."), true);
});
