# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (this document
describes the contract) from design to implementation.

- Plans live in `.agents/execplans/YYYY-MM-DD-<slug>.md`, one file per initiative.
- A plan is **living**: keep `## Progress` current (checkboxes with dates); record decisions
  and discovered constraints in `## Decision log` as you go.
- Each Progress step ends in a commit; conventional commit messages.
- Plans are self-contained: a new session must be able to continue from the plan alone plus
  `docs/specs/`.
- Enduring design decisions belong in `docs/specs/**` with a dated
  `Revision note (YYYY-MM-DD): ...` line; the plan links to them instead of duplicating.
