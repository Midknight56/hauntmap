# Kiro IDE session, 20 November 2026

Kiro IDE opened on this repository, on the side display, with a small spec of its own (`.kiro/specs/node-builtins/`: failing tests, the fix, the docs line). Kiro IDE ran the three tasks from the `Start task` links of `tasks.md`, then a fourth request in a new chat session. Facts below were read from the screen, from the IDE's own log (`Kiro Logs.log` in `%APPDATA%\Kiro\logs`) and from the process list.

| Step | What was seen | File |
| --- | --- | --- |
| Window on the side display | The IDE window was moved 1.2 s after start to x -1998, y 40 (`window-guard.log`). A window list taken while it ran shows `hauntmap - Kiro left=-1998 top=40 right=-98 bottom=1090` (`window-list.txt`). | `window-list.txt`, `window-guard.log` |
| Spec tasks | `tasks.md` shows a `Start task` link above each task. Task 1 (tests first) ended with the new external cases failing as the task asks (31 tests, 1 failed). Task 2 ended with 31 of 31 passing and `pnpm typecheck` clean. Task 3 added the docs line. Credits used by the IDE: 1.75, 1.71 and 1.44. | `01-tasks-start-task-links.jpg`, `02-task-1-running.jpg` |
| Hook files read | The Agent Hooks panel of the IDE lists all three files of `.kiro/hooks/` (`analyze-live`, `typecheck-on-save`, `verify-on-stop`). The tooltip of `typecheck-on-save` shows `Trigger: PostFileSave`, `Command: pnpm typecheck` and `Matcher: \.(ts|tsx)$`. The log line is `hooks.reload.loaded {"read":3,"registered":3}`. | `03-agent-hooks-panel-three-hooks-read.jpg` |
| Hooks start switched off | In a fresh window each hook was labelled `(disabled)`. The eye icon beside `typecheck-on-save` wrote `"enabled": true` into `.kiro/hooks/typecheck-on-save.json` (the log says `fs.setHookEnabledWrite.ok`). After `Developer: Reload Window` the three hooks no longer carried the label. | `06-editor-and-hooks-after-reload.jpg` |
| Save in the editor | A line was added to `src/analysis/parser/resolve.ts` and saved with Ctrl+S, then taken out and saved again. No `pnpm typecheck` process started in the 25 seconds after either save, and the IDE log has no line that says a hook ran (it only reloads the hook list). | none |
| Save by the agent, new chat session | A request in a new chat session made the agent edit `tests/analysis/resolve.test.ts`. The chat showed `1 hook triggered` and a row `Run Command Hook typecheck-on-save`. The process list shows `cmd.exe /d /s /c "pnpm typecheck"` started at 1:47:18 PM, its parent a `Kiro.exe` process (`hook-process-log.txt`). | `04-hook-triggered-typecheck-on-save.jpg`, `hook-process-log.txt` |
| End of the turn | Two more rows, `Run Command Hook analyze-live` and `Run Command Hook verify-on-stop`, appeared when the turn ended. This is the same `Stop` behaviour seen in the CLI. | `05-turn-end-stop-hooks-ran.jpg` |

## How the IDE differed from the CLI

- The IDE asks for approval on each shell command the agent runs (`Allow`, `Always allow`, `Deny`). The headless CLI runs with `--trust-all-tools` and asks nothing.
- The IDE runs a spec task in a sub-agent called `spec-task-execution` and ticks the box in `tasks.md` itself. The CLI run ticked the boxes by an instruction in the prompt.
- Hooks show in the chat as `Run Command Hook <name>` rows. In the CLI the hook output came back to the session as text.
- The IDE shows each hook with its trigger, command and matcher, and starts them switched off until someone enables them. The CLI read the same files with no such step.
- `PostFileSave` ran for a file the agent wrote in a new chat session. A Ctrl+S in the editor, in this window, started no typecheck in the time watched. Only one window and one run were seen, so this says nothing about other versions.
- The IDE opens a folder in Restricted Mode until the folder is trusted.
