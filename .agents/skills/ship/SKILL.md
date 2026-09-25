---
name: ship
description: Ship all current repository changes by reviewing them, creating one Conventional Commit, and pushing the current branch. Use only when the user explicitly asks to ship the work or invokes this skill.
---

# Ship

From the repository root:

1. Review staged and unstaged changes with `git diff` and `git diff --cached`.
2. Stage all changes with `git add -A`.
3. Generate one Conventional Commits subject line and commit all staged changes.
4. Push the current branch with `git push origin HEAD`.

Use one of these commit prefixes: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`, `perf`, `ci`, or `build`.

Format the subject as `prefix(scope): description`, using an optional scope that identifies the affected module, component, or area. Omit the scope for broad changes or changes that do not map cleanly to one area.

The commit message must:

- Be a single subject line under 72 characters.
- Use lowercase after the prefix.
- Describe the change specifically.
- Have no trailing period.
- Contain no body, footers, attribution, tool names, or skill paths.

When this skill is explicitly invoked, run the full stage, commit, and push sequence without asking for an additional confirmation. If a real blocker occurs, report it rather than changing unrelated repository state.
