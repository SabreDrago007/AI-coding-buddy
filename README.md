# AI Coding Buddy

A VS Code coding tutor designed to **delay the answer** rather than autocomplete your thinking away.

## Core idea

Coding Buddy estimates how much the learner is struggling on a 1–3 scale:

| Level | Behavior |
|---|---|
| **1** | Subtle conceptual hint; no code solution |
| **2** | More concrete debugging/algorithm hint; still no finished solution |
| **3** | Direct solution, including corrected code when the model can provide it |

The learner can always override the classifier manually.

## Current commands

- `AI Coding Buddy: Get Hint`
- `AI Coding Buddy: Get Struggle Level`
- `AI Coding Buddy: Set Manual Level`
- `AI Coding Buddy: Start Learning Session`
- `AI Coding Buddy: Finish Learning Session`
- `AI Coding Buddy: Reset`

The status bar displays the current estimated/manual level.

## Privacy-preserving learning sessions

Learning sessions are explicitly started by the user. Starting a session shows a privacy notice. When the user finishes it, the extension saves one labeled row locally. It does not save source code or workspace names, and it does not upload session data. An unfinished session is held only in memory and discarded when VS Code closes.

The CSV is saved in the extension's VS Code global storage as `learning_sessions.csv`. Each row contains the starting predicted level, the last manually selected level (if any), whether a stronger hint was requested, whether the task was solved, elapsed time for solved sessions, Python run attempts, and the five behavioral features.

These sessions are not yet used to retrain the classifier. The current model still uses a synthetic prototype dataset, so synthetic evaluation results are not evidence of real-world accuracy.

## Run locally

```bash
npm install
npm run compile
```

Then open the folder in VS Code and press **F5** to launch an Extension Development Host.
