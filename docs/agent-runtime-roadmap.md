# Agent Runtime Roadmap

Pi Desktop desktop releases already bundle a Node.js runtime with the Next.js
standalone server. Users do not need Node.js or npm installed on their system.
This roadmap concerns the long-term cost and complexity of that embedded
runtime, not the current end-user installation flow.

## Direction

Move toward a Tauri application with a Rust-native backend and statically built
frontend, while preserving compatibility with Pi user data and customization
where practical. Pi's agent packages are open source under the MIT license, but
this project should define and test compatible behavior rather than mechanically
translating their TypeScript implementation.

## Stages

1. Keep the current Next.js and Pi JavaScript SDK backend, including the
   packaged Node runtime, while product work continues.
2. Introduce a narrow agent-backend boundary so application routes do not depend
   directly on `@earendil-works/pi-coding-agent`.
3. Implement Rust-owned services with stable, tested contracts, starting with
   session JSONL handling, filesystem access, and local server lifecycle.
4. Run the official Pi JavaScript agent as an embedded sidecar while replacing
   compatible modules incrementally. Preserve the session format, streamed
   event behavior, and resource-loading expectations before switching callers.
5. Evaluate a Rust-native implementation of the agent loop, provider adapters,
   tool execution, and resource loading only after compatibility coverage and
   maintenance cost justify it.

## Non-goals

- Do not require end users to install Node.js during the transition.
- Do not fork or rewrite Pi merely for language parity.
- Do not break existing Pi sessions, skills, plugins, or credentials without a
  documented migration path.

## Decision Gates

Each replacement should demonstrate equivalent behavior for supported session
files, streaming and cancellation, authentication, tool permissions, and
extensions. The project should retain the JavaScript backend as a fallback until
the Rust path meets those compatibility checks on supported platforms.
