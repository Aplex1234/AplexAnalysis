# AplexAnalysis performance report

Measured locally on 2026-08-29 using the production Sites build and Chromium against the same machine and route (`/`, AAPL Overview). Values are uncompressed local transfer sizes, so production compression should reduce absolute network bytes further. The before and after comparisons use the same build and browser tools.

## Results

| Benchmark | Before | After | Change |
| --- | ---: | ---: | ---: |
| Main stylesheet | 318,401 B | 106,084 B | **-66.7%** |
| Initial resource transfer | at least 1,291,492 B | 1,007,029 B total | **at least -22.0%** |
| DOM interactive | 173.9 ms | 140.1 ms | **-19.4%** |
| First contentful paint | 416 ms | 408 ms | -1.9% |
| Window load | 204 ms | 198 ms | -2.9% |
| Cached Overview API median | 107.6 ms | 100.1 ms | -6.9% |
| Production build time | 15.4 s | 5.3 s | **-65.5%** |
| Client modules processed | 1,514 | 745 | **-50.8%** |

The initial page response start was effectively unchanged (104.8 ms before, 106.5 ms after). That is expected because the first server-rendered page still reads the shared database and renders the same financial content. The improvement is concentrated in browser download/processing and warm repeat reads.

## Bottlenecks found

1. The app loaded the full Carbon React component runtime for a small set of basic controls.
2. Carbon component styles included many variants the app never rendered.
3. Icon imports used a broad package entry point.
4. Every repeat analysis read started at the shared D1 cache, even when the same worker had just returned the same compatible snapshot.
5. Recharts remains the largest client dependency because interactive price and financial charts are visible on Overview.

## Improvements made

- Replaced the heavy Carbon React runtime controls with small accessible AplexAnalysis primitives using native buttons, inputs, status messages, tags, loading placeholders and theme wrappers.
- Kept the same labels, roles, keyboard behavior, loading states, theme control and visual layout.
- Reduced Carbon styles to the reset only and added focused styles for the primitives actually used.
- Switched icons to direct module imports so unused icon exports are not traversed into the app bundle.
- Added a bounded 30-second, 64-company worker-local hot cache above D1. D1 remains the universal source of truth and every new worker still reads shared cached data.
- Kept view tracking and refresh scheduling in the background so they do not intentionally block the response.
- Tightened the automated stylesheet performance budget to 250 KB and added a hot-cache regression test.

## Verification

- Sites production build passed.
- 63 hosted application tests passed.
- Frontend type checking and 10 focused frontend tests passed.
- Both production dependency audits reported zero known vulnerabilities.
- Desktop and 390 px mobile browser checks passed with no console errors or page-level horizontal overflow.
- Search suggestions, Valuation navigation, theme switching, charts, refresh control and loading/status semantics remained available.

## Remaining performance opportunity

Recharts is now the largest first-page cost. Replacing it or deferring the visible Overview charts could reduce the initial download further, but either option carries meaningful chart-interaction or perceived-loading tradeoffs. It was intentionally left unchanged to honor the requirement not to reduce usability or remove features.
