# AI Coding Buddy

AI Coding Buddy is a VS Code tutor that estimates when a learner may be stuck and adapts the amount of help. It supports Python, Java, C, and C++ for hints and running the active file.

## Features

- Three assistance levels: Level 1 gives a broad prompt, Level 2 gives focused reasoning without the direct answer, and Level 3 gives a direct answer with an explanation.
- A dedicated sidebar with language selection, hints, DSA logic review, assistance levels, timer controls, code runners, and learning settings.
- The sidebar opens automatically when a supported code file becomes active.
- DSA logic review for arrays and strings, linked lists, stacks and queues, trees, heaps, graphs, sorting/searching, recursion, backtracking, dynamic programming, and greedy methods.
- Automatic struggle estimates use editor evidence such as errors, failed runs, deletion bursts, rapid edits, and cursor-line revisits. Time passing alone never raises assistance.
- Optional local learning-session recording and personalized model training.

## Install from a VSIX

You can download a prebuilt VSIX from the [GitHub release](https://github.com/SabreDrago007/AI-coding-buddy/releases) or the latest successful [Extension checks workflow](https://github.com/SabreDrago007/AI-coding-buddy/actions/workflows/ci.yml): open the run, download the **ai-coding-buddy-vsix** artifact, and extract the VSIX. GitHub keeps workflow artifacts for 30 days.

Build the installable extension package from the project folder:

```bash
npm ci
npm run package
```

This creates `ai-coding-buddy-0.0.11.vsix`. In VS Code, open **Extensions → … → Install from VSIX…** and select that file. You can also install it from a terminal with `code --install-extension ai-coding-buddy-0.0.11.vsix`.

## Requirements

- VS Code 1.90 or later.
- Ollama running locally with the configured model (default `qwen2.5-coder:7b`) for AI generated hints. Install Ollama, then run `ollama pull qwen2.5-coder:7b`.
- Python 3 plus the packages in `requirements.txt` for the Random Forest classifier. Set **AI Coding Buddy: Python Path** if Python is not discoverable. If the model cannot start, the extension warns once and continues with a built-in rule estimate.
- To run files from the language dropdown, install the corresponding runtime/compiler: Python 3, JDK (`javac` and `java`), GCC/Clang for C, and G++/Clang++ for C++. Configure executable paths in VS Code Settings if they are not on `PATH`.

The extension does not bundle Ollama, language runtimes, compilers, or Python ML packages. Running a file executes the active file after saving it, with a 120-second process limit. This runner is non-interactive; programs that need keyboard input should be run in a terminal. In an untrusted VS Code workspace, the extension asks for confirmation before running code. Use **AI Coding Buddy: Run Current File** only for code you intend to execute.

## Assistance levels

| Level | Help |
|---|---|
| **1** | One broad guiding question about the concept; no code, exact bug, or correction |
| **2** | A focused reasoning strategy and test idea; more actionable than Level 1, but no exact condition, value, result, or solution |
| **3** | The specific faulty code section corrected, with an explanation of what went wrong and why the fix works |

Level 2 is checked by conservative local patterns and a second model review. If either check flags or cannot verify a response, the extension uses a safe fallback hint. Language models can still make mistakes, so this reduces answer leaks but cannot guarantee a perfect boundary for every prompt or model.

AI Coding Buddy has its own **Activity Bar** icon and persistent sidebar view. The sidebar opens automatically when a supported code file becomes active; select the lightbulb icon to reopen it at any time. The view keeps the Programming language dropdown (Auto-detect, Python, Java, C, and C++), assistance levels, hint request, DSA logic review, timer controls, run actions, and learning settings beside your editor. Use **AI Coding Buddy: Start Quick Tutorial** for an in-extension guide. From the Command Palette, **AI Coding Buddy: Select Programming Language** and **AI Coding Buddy: Configure Level Time Limits** are also available. Time limits set minimum recheck intervals; time passing alone never raises assistance. **Check Code Logic** reviews common DSA tasks across arrays and strings, linked lists, stacks and queues, trees, heaps, graphs, sorting/searching, recursion, backtracking, dynamic programming, and greedy methods. It checks algorithm and control-flow choices, indexing and invariants, unnecessary or missing operations, and language/API mismatches. It infers the task from names, comments, signatures, data structures, and code flow across common DSA areas; you can optionally supply the task or postcondition to disambiguate similar operations. If intent remains ambiguous, it asks you to clarify instead of judging the wrong algorithm. The inferred or supplied goal is passed into hint generation so review and guidance target the same task. A confident issue adds a local struggle signal, raises automatic help to at least Level 2, and returns guidance at the current level. “Run Interactively” launches in a VS Code terminal for stdin input; “Run Current File” uses a bounded output/time runner. Both execute with your user permissions. Use “Check Setup” to inspect local tools and the optional Ollama model. The language selection controls both hint context and **Run Current File**. Auto-detect follows the active editor's language mode.

## Privacy

Hint requests and logic reviews include the selected text, or the whole active document when nothing is selected, and send it to the configured Ollama URL. Logic review and its follow-up hint include the optional task description or inferred DSA intent. The default endpoint is `http://127.0.0.1:11434/api/generate`. Remote endpoints must use HTTPS and require confirmation before each review/hint flow. The endpoint and executable paths are machine-level settings, so project workspace settings cannot silently redirect requests or substitute a compiler/interpreter. Long text is sampled from the beginning and end, up to the configured character limit. Source text is treated as untrusted prompt input, but model guidance and filters are not a security boundary; semantic checks can miss mistakes or flag false positives.

Learning-session recording is separate and opt-in: start and finish each session using the AI Coding Buddy commands. The extension stores one local CSV row of behavior counts and your feedback; it does not include source code or workspace names, and it is never uploaded. Export or clear these records with the matching commands in the Command Palette. Unfinished sessions are discarded when VS Code closes.

Automatic assistance does not rise just because time passes. Time limits set minimum recheck intervals; a rise also requires struggle evidence such as repeated errors, failed runs, deletion bursts, rapid edits, or rapid cursor-line revisits. Time spent on a line can strengthen those signals but cannot raise the level by itself. Cursor-line changes are only a rough proxy for navigation; VS Code extensions do not expose continuous native mouse movement. Recent event counts are kept in memory and only aggregate counts are written to an opt-in learning-session CSV.

## Learning sessions and model limitations

Rows include the starting predicted level, last manual level, whether the user explicitly requested stronger help, solved status, elapsed time for solved sessions, run attempts, and behavioral features such as time on the current line, recent deletion bursts, rapid cursor-line revisits, and confirmed logic concerns. Older CSV files remain usable; missing newer measurements default to zero. Use “AI Coding Buddy: Train from Labeled Sessions” to create an optional model locally. Training ignores rows without an explicitly chosen manual level and requires at least 30 labeled sessions with 5 at each level. It writes a separate model in VS Code global storage and a SHA-256 checksum; source CSV data is never uploaded. Manual levels represent user preference, not objective ground truth, and a small personal dataset may overfit. The bundled Random Forest was trained on synthetic prototype data, so its results do not establish real-world accuracy. Level 2's output check is heuristic rather than a guarantee.

## Development

```bash
npm install
npm run compile
```

Open the folder in VS Code and press **F5** to launch an Extension Development Host. `npm run package` compiles and creates a VSIX through `@vscode/vsce`.


