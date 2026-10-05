# AI Coding Buddy

AI Coding Buddy is a VS Code extension that estimates when a learner may be stuck and adapts its help. It supports Python, Java, C, and C++ for hints and running the active file.

## Features

- Three assistance levels: Level 1 gives a broad prompt, Level 2 gives focused reasoning and a test idea without the direct answer, and Level 3 gives a direct answer with an explanation.
- A status-bar control panel with a language selector, struggle level, logic review, and setup checks.
- DSA logic review for common arrays and strings, linked lists, stacks and queues, trees, heaps, graphs, sorting and searching, recursion, backtracking, dynamic programming, and greedy methods.
- Automatic struggle estimates based on evidence such as errors, failed runs, deletion bursts, rapid edits, and cursor-line revisits. Time passing or line dwell alone never raises assistance.
- Optional, local learning-session recording and personalized model training.
- File execution for Python, Java, C, and C++; interactive programs can run in a VS Code terminal.

## Install from a VSIX

You can download a prebuilt VSIX from the latest successful [Extension checks workflow](https://github.com/SabreDrago007/AI-coding-buddy/actions/workflows/ci.yml): open the run, download the **ai-coding-buddy-vsix** artifact, and extract the VSIX. GitHub keeps this CI artifact for 30 days.

Or build the extension package from the project folder:

```bash
npm ci
npm run package
```

This creates `ai-coding-buddy-0.0.9.vsix`. In VS Code, open **Extensions → … → Install from VSIX…** and select the file. Or run:

```bash
code --install-extension ai-coding-buddy-0.0.9.vsix
```

## Requirements and setup

- **VS Code 1.90 or later.**
- **Ollama** for locally generated hints. Install Ollama, then download the default model with `ollama pull qwen2.5-coder:7b`. The model and endpoint can be changed in VS Code Settings.
- **Python 3 and the packages in `requirements.txt`** for the optional Random Forest classifier. Install them with `python -m pip install -r requirements.txt`. Set **AI Coding Buddy: Python Path** if Python is not discoverable. If the classifier cannot start, the extension warns once and continues with its built-in rule estimate.
- **Language runtimes and compilers** to run files: Python 3, a JDK (`javac` and `java`), GCC or Clang for C, and G++ or Clang++ for C++. Configure executable paths in VS Code Settings when they are not on `PATH`.

The extension does not bundle Ollama, language runtimes, compilers, or Python ML packages.

## Use the extension

Open the status-bar control panel to choose a language and assistance level. Use **Get Hint** for guidance on the selected text, or the full active document when no text is selected. Use **Check Code Logic** to review an algorithm. Add a short task description or expected postcondition when the intended DSA operation is ambiguous. When the review finds a confident issue, it contributes a struggle signal and targets follow-up guidance at that same task.

The programming-language selector supports **Auto-detect**, **Python**, **Java**, **C**, and **C++**. Auto-detect follows the active editor's language mode. The selected language controls hint context and **Run Current File**.

**Run Current File** saves and runs the active file with a 120-second process limit and bounded output. It is non-interactive; programs that need keyboard input should use **Run Interactively**, which opens the program in a VS Code terminal. Both commands execute with your user permissions. In an untrusted workspace, the extension asks for confirmation before running code. Run only code you intend to execute.

Use **Check Setup** to inspect local tools and the optional Ollama model. Learning sessions are opt-in: start and finish a session with the corresponding AI Coding Buddy commands. Export or clear recorded data through the Command Palette.

## Assistance levels

| Level | Help |
|---|---|
| **1** | A broad guiding question about the concept; no code, exact bug, or correction. |
| **2** | A focused reasoning strategy and test idea, without the direct answer or exact solution. |
| **3** | The direct answer, focused corrected code when useful, and an explanation of why it works. |

Level 2 uses conservative local checks and a second model review. If either check flags a response or cannot verify it, the extension uses a safe fallback hint. These checks reduce answer leaks but cannot guarantee a perfect boundary for every prompt and model.

## Privacy and data

Hint requests and logic reviews send the selected text, or the whole active document when nothing is selected, to the configured Ollama URL. Logic review and its follow-up hint also include the optional task description or inferred DSA intent. The default endpoint is `http://127.0.0.1:11434/api/generate`. Remote endpoints must use HTTPS and require confirmation before each hint or review flow. Endpoint and executable paths are machine-level settings, preventing workspace settings from silently redirecting requests or substituting a compiler or interpreter.

Long source text is sampled from the beginning and end up to the configured character limit. Source code is treated as untrusted prompt input. Model guidance and filters are not a security boundary; semantic checks can miss mistakes or flag false positives.

Learning-session recording is separate and opt-in. It stores one local CSV row of behavior counts and feedback, without source code or workspace names, and is never uploaded. Recent behavior counts stay in memory; only aggregate counts are written to the CSV. Unfinished sessions are discarded when VS Code closes.

## Struggle model and limitations

Automatic assistance does not rise just because time passes. Time limits set minimum recheck intervals. An increase also requires struggle evidence, such as repeated errors, failed runs, deletion bursts, rapid edits, or rapid cursor-line revisits. Time on a line can strengthen those signals but cannot raise the level by itself. Cursor-line changes are only a rough proxy for navigation; VS Code extensions do not expose continuous native mouse movement.

Use **AI Coding Buddy: Train from Labeled Sessions** to create an optional model locally. Training ignores sessions without an explicitly chosen manual level and requires at least 30 labeled sessions, with at least 5 at each level. It writes a separate model in VS Code global storage with a SHA-256 checksum. Older CSV files remain usable; missing newer measurements default to zero. Manual levels represent user preference rather than objective ground truth, and a small personal dataset may overfit. The bundled Random Forest was trained on synthetic prototype data, so its results do not establish real-world accuracy. Level 2's output check is heuristic, not a guarantee.

## Development

```bash
npm ci
npm test
npm run compile
npm run package
```

`npm test` compiles TypeScript and runs the automated test suite. To launch an Extension Development Host, open the project folder in VS Code and press **F5**.
