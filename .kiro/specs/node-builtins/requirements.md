# Requirements: node-builtins

A `node:` specifier names a Node built-in module. The resolver now reports it as an unconfigured path alias, because the colon fails the package name test. `.kiro/steering/analysis.md` and `.kiro/steering/revision-2026-11-16.md` apply.

## 1. Built-in modules are external

1.1 WHEN a specifier is `node:` followed by one or more of the characters letters, digits, `_`, `/` and `-`, THE SYSTEM SHALL resolve it as `{ resolution: "external", to: null }`, the same result as `fs`.
1.2 `node:fs`, `node:fs/promises` and `node:test` each resolve as external, with no `reason`.
1.3 A `node:` specifier never becomes a local room and never adds a diagnostic.

## 2. Malformed forms stay unresolved

2.1 WHEN a specifier is exactly `node:`, THE SYSTEM SHALL resolve it as `{ resolution: "unresolved", to: null, reason: "alias-not-configured" }`.
2.2 WHEN a specifier is `node:` followed by a space, as in `node: fs`, or by any character outside letters, digits, `_`, `/` and `-`, THE SYSTEM SHALL resolve it as unresolved with reason `alias-not-configured`.
2.3 WHEN the prefix is not exactly lower case `node:`, as in `Node:fs`, THE SYSTEM SHALL resolve it as unresolved with reason `alias-not-configured`.

## 3. Other specifiers do not change

3.1 WHEN a specifier is relative, starts with `#`, or starts with `@/`, THE SYSTEM SHALL return the same resolution as before this change.
3.2 WHEN a specifier is a valid npm package name, THE SYSTEM SHALL still resolve it as external.
3.3 The name is not checked against a list of real Node modules. `node:nothing` is external, because the resolver reports the syntax and does not know the Node version of the analyzed project.
