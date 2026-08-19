---
name: using-superpowers
description: Use at the start of non-trivial SubApp development, migration, debugging, planning, or verification to select the relevant Superpowers workflow before acting.
---

# Using Superpowers in a Taku SubApp

Use the host's registered `superpowers:*` skills when they are available. If the host does not expose them, this project includes a read-only fallback bundle at `.agent-tools/superpowers/6.2.0/skills/`.

## Bootstrap

1. Read the task and the app-local `AGENTS.md` before changing files.
2. Select the process skill that matches the work:
   - new behavior or design: `brainstorming`, then `writing-plans`;
   - implementation: `test-driven-development`;
   - bug or failing check: `systematic-debugging`;
   - final handoff: `verification-before-completion`.
3. Invoke the registered skill when the harness supports it. Otherwise read `.agent-tools/superpowers/6.2.0/skills/<skill>/SKILL.md` completely and follow it.
4. User instructions and app-local rules take precedence over the bundled methodology.

Do not edit the vendored bundle during product work. It is pinned so another Agent can reproduce the same workflow later.
