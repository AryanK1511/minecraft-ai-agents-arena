---
name: deslop
description: Remove AI-generated code slop from the current branch by comparing it with main. Use when asked to deslop, clean up AI-written changes, or align a branch with the repository's existing coding style.
---

# Remove AI code slop

Compare the current branch against `main` and remove AI-generated slop introduced by the branch.

Look especially for:

- Comments a human maintainer would not add or that are inconsistent with the surrounding file.
- Defensive checks or `try`/`catch` blocks that are abnormal for that area, especially on trusted or already-validated code paths.
- Casts to `any` used to bypass type errors.
- Other code or prose whose style is inconsistent with the surrounding codebase.

Preserve intentional behavior. Validate the resulting changes in proportion to their scope.

End with only a one-to-three-sentence summary of what changed.
