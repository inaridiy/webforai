---
"webforai": minor
---

**Agent mode keeps the links an agent needs.**

- On pages a site adapter claims (WordPress, Docusaurus, MkDocs, …), `agentExtractor` used to
  return the adapter's output with no link sections. It now keeps the adapter's content and still
  lists the page's other links by role. `createAgentAutoExtractor(options)` builds this extractor
  with your own options; `createAgentExtractor` stays the version without adapters.
- Card links — an `<a href>` wrapped around a block, as in article cards — are listed.
- Links in collapsed or hidden menus (dropdowns, mobile menus) are listed under Site navigation:
  at most 200, and none from consent banners or to sign-in, account, shop or legal pages.
- The role models were retrained on more pages and gained a keep model that decides whether a
  block's links are listed at all; the role decides only where. `keepScale` (new option, default
  1) scales that threshold: lower lists more links.
- Each link is listed once, by its resolved URL. Share and "send to" links are always left out,
  and so are links to anything but a web page (`mailto:`, `sms:`, `javascript:`, …).
- The `comments` preset uses the same retrained models.
