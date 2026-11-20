# Performance

Figures recorded by a named check on a named machine. A figure that is not in this file is a target, not a claim.

## Machine

Read on 2026-11-16 with `Get-CimInstance Win32_Processor` and `Win32_ComputerSystem`: AMD Ryzen 9 9950X 16-Core Processor, 93.6 GB memory (`TotalPhysicalMemory`), Windows 11 Pro. Node v24.19.0, pnpm 12.3.4.

## MCP server

| Date | Check | Figure | Target |
| --- | --- | --- | --- |
| 2026-11-16 | `pnpm vitest run tests/kiro/server.test.ts --silent=false -t "response time"`: one `tools/call` of `analyze` for `haunts/manor` (40 modules) over stdio, measured in the test from the request to the response, with the server already started | 59 ms, one run | 2,000 ms |

The figure is one run on the machine above, after the server had started and answered `initialize`. It does not include process start-up and says nothing about other folders or other machines.

## Intake

| Date | Check | Figure | Target |
| --- | --- | --- | --- |
| 2026-11-19 | `tests/intake/e2e/local.spec.ts`, case `timing (3.7)`: a generated folder of 200 files, 10,240 bytes each (2.0 MiB), from activating `Analyze` until the store holds the investigation with `layoutStatus` `"idle"` and a layout | 331 ms in the first run, 891 ms in the run with `HAUNTMAP_SHOTS=1` | 3,000 ms |

Figures for this PC only, headless Chromium with software rendering, the development build. The test prints the figure and does not fail on it. The two runs differ because other work shared the CPU in the second one; no figure is claimed beyond these two runs.