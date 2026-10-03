---
"webforai": patch
---

All browser loaders annotate rendered geometry. The Puppeteer and Cloudflare Puppeteer loaders now
run the same `data-rwidth`/`data-rheight` annotation as the Playwright loader before reading the
page, so extraction drops elements the browser laid out to nothing (menus and sections hidden with
CSS classes) whichever loader fetched the page. The annotation is exported as `annotateGeometry`
from `webforai/loaders/geometry` for pages rendered with your own browser code
(`await page.evaluate(annotateGeometry)` before `page.content()`).
