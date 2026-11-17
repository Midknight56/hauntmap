# Performance

Figures recorded by a named check on a named machine. A figure that is not in this file is a target, not a claim.

## Machine

Read on 2026-11-16 with `Get-CimInstance Win32_Processor` and `Win32_ComputerSystem`: AMD Ryzen 9 9950X 16-Core Processor, 93.6 GB memory (`TotalPhysicalMemory`), Windows 11 Pro. Node v24.19.0, pnpm 12.3.4.

## MCP server

| Date | Check | Figure | Target |
| --- | --- | --- | --- |
| 2026-11-16 | `pnpm vitest run tests/kiro/server.test.ts --silent=false -t "response time"`: one `tools/call` of `analyze` for `haunts/manor` (40 modules) over stdio, measured in the test from the request to the response, with the server already started | 59 ms, one run | 2,000 ms |

The figure is one run on the machine above, after the server had started and answered `initialize`. It does not include process start-up and says nothing about other folders or other machines.
