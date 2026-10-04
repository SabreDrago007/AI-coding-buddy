# AI Coding Buddy

AI Coding Buddy is a VS Code tutor that estimates when a learner may be stuck and adapts the amount of help. It supports Python, Java, C, and C++ for hints and running the active file.

## Install from a VSIX

Build the installable extension package from the project folder:

```bash
npm install
npm run package
```

This creates `ai-coding-buddy-0.0.2.vsix`. In VS Code, open **Extensions → … → Install from VSIX…** and select that file. You can also install it from a terminal with `code --install-extension ai-coding-buddy-0.0.2.vsix`.

## Requirements

- VS Code 1.90 or later.
- Ollama running locally with the configured model (default `qwen2.5-coder:7b`) for AI generated hints. Install Ollama, then run `ollama pull qwen2.5-coder:7b`.
- Python 3 plus the packages in `requirements.txt` for the Random Forest classifier. Set **AI Coding Buddy: Python Path** if Python is not discoverable. If the model cannot start, the extension warns once and continues with a built-in rule estimate.
- To run files from the language dropdown, install the corresponding runtime/compiler: Python 3, JDK (`javac` and `java`), GCC/Clang for C, and G++/Clang++ for C++. Configure executable paths in VS Code Settings if they are not on `PATH`.

The extension does not bundle Ollama, language runtimes, compilers, or Python ML packages. Running a file executes the active file after saving it, with a 120-second process limit. This runner is non-interactive; programs that need keyboard input should be run in a terminal. In an untrusted VS Code workspace, the extension asks for confirmation before running code. Use **AI Coding Buddy: Run Current File** only for code you intend to execute.

## Assistance levels

| Level | Help |
|---|---|
| **1** | Subtle conceptual hint; no code solution |
| **2** | Specific debugging guidance without executable code |
| **3** | Direct explanation and corrected code when useful |

Use the status bar to open the theme-aware control panel. It updates in place as the level changes, supports keyboard focus, and respects reduced-motion settings. The programming-language dropdown supports Auto-detect, Python, Java, C, and C++. The selection controls both hint context and **Run Current File**. Auto-detect follows the active editor's language mode.

## Privacy

Hint requests include the selected text, or the whole active document when nothing is selected, and send it to the configured Ollama URL. The default endpoint is `http://127.0.0.1:11434/api/generate`. Remote endpoints must use HTTPS and require confirmation before each request. The endpoint and executable paths are machine-level settings, so project workspace settings cannot silently redirect requests or substitute a compiler/interpreter. Long text is sampled from the beginning and end, up to the configured character limit. Source text is treated as untrusted prompt input, but model guidance and the Level 2 filter are not a security boundary.

Learning-session recording is separate and opt-in: start and finish each session using the AI Coding Buddy commands. The extension stores one local CSV row of behavior counts and your feedback; it does not include source code or workspace names, and it is never uploaded. Export or clear these records with the matching commands in the Command Palette. Unfinished sessions are discarded when VS Code closes.

## Learning sessions and model limitations

Rows include the starting predicted level, last manual level, whether the user explicitly requested stronger help, solved status, elapsed time for solved sessions, run attempts, and behavioral features. These rows are not used to retrain the model yet. The bundled Random Forest was trained on synthetic prototype data, so its results do not establish real-world accuracy. Level 2's output check is heuristic rather than a guarantee.

## Development

```bash
npm install
npm run compile
```

Open the folder in VS Code and press **F5** to launch an Extension Development Host. `npm run package` compiles and creates a VSIX through `@vscode/vsce`.
