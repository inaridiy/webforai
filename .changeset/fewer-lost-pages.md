---
"webforai": minor
---

Fewer pages come out empty or cut short: a forum thread that Discourse or Flarum ships only inside `<noscript>` is converted (and `detectClientShell` no longer flags such pages), a listing whose items the models score just under the threshold keeps them instead of collapsing to its title, and the heuristic extractor climbs through section wrappers to their sibling sections (the Gradle compatibility page lost four of its five). On WCXB's development split the share of forum pages scoring under F1 0.2 falls from 23.9% to 7.1%.
