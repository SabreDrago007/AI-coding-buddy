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

## MVP architecture

```text
VS Code Extension
   │
   ├── Behavior telemetry
   │     ├── edits / corrections
   │     ├── backspaces
   │     ├── cursor reversals
   │     ├── rapid edit bursts
   │     ├── idle time
   │     └── compiler/linter diagnostics
   │
   ├── Struggle Classifier
   │     └── deterministic MVP → learned model later
   │
   └── Hint Engine
         └── VS Code Language Model API when available
              ↓
         level-aware tutoring prompt
```

## Important limitation

The standard VS Code extension API does **not** expose raw mouse movement/velocity in the editor. We therefore do not pretend that mouse behavior is available. The MVP uses observable editor behavior instead. A future companion process could collect richer OS-level mouse telemetry, but that should be opt-in and privacy-conscious.

## Current commands

- `Coding Buddy: Give Me a Hint`
- `Coding Buddy: Set Struggle Level`
- `Coding Buddy: Reset Struggle Detection`

The status bar displays the current estimated/manual level.

## Run locally

```bash
npm install
npm run compile
```

Then open the folder in VS Code and press **F5** to launch an Extension Development Host.

## Learning loop — planned

The next major feature is collecting **privacy-preserving labeled struggle sessions**. Each session should contain only behavioral features and user feedback such as:

- predicted level
- manually selected level
- whether the user requested a stronger hint
- time until successful fix
- number of attempts before success

This creates training data for a learned classifier without storing source code by default.
