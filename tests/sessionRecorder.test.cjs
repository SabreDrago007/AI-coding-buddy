const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SessionRecorder } = require("../out/sessionRecorder.js");

test("session recorder writes feedback and behavior only to a local CSV", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "coding-buddy-test-"));
    try {
        const recorder = new SessionRecorder(tempDirectory);
        recorder.start(1);
        recorder.recordManualLevel(2);
        recorder.recordHint(2);
        recorder.recordAttempt();
        await recorder.finish(true, {
            idle_seconds: 4,
            errors: 1,
            failed_runs: 0,
            deletions: 2,
            rapid_edits: 3,
            stuck_line_seconds: 60,
            deletion_bursts: 4,
            navigation_bursts: 3,
            logic_concerns: 1
        });

        const csv = await fs.readFile(recorder.dataFilePath, "utf8");
        const rows = csv.trim().split(/\r?\n/);
        assert.equal(rows.length, 2);
        assert.match(rows[0], /predicted_level,manual_level,requested_stronger_hint,solved/);
        assert.match(rows[0], /stuck_line_seconds,deletion_bursts,navigation_bursts,logic_concerns$/);
        assert.match(rows[1], /^1,2,true,true,1,\d+,1,4,1,0,2,3,60,4,3,1$/);
        assert.doesNotMatch(csv, /source|workspace|secret/i);
        assert.equal(recorder.isActive, false);
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true });
    }
});
