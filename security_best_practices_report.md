# AplexAnalysis security and quality audit

Audited: 2026-08-29
Scope: the ChatGPT Sites application, shared frontend, standalone development API, Git-tracked configuration, and the current public deployment.

## Security checks

1. **PASS - Hide API keys.** No hardcoded secret patterns were found in tracked source or public assets. `.env.example` contains placeholders only.
2. **PASS - Environment variables.** Server settings use environment or Cloudflare bindings. The only browser-exposed variable is the intentionally public `NEXT_PUBLIC_API_URL`.
3. **PASS - Keys in Git.** A high-signal secret scan of tracked files and Git history returned no matches.
4. **PASS - Protect admin routes.** There are no admin routes. The previously public `/api/v1/cache/status` operational endpoint now returns 404 (`sites-app/app/api/v1/cache/status/route.ts`).
5. **NOT APPLICABLE - Authentication.** The product currently exposes public company research only and has no account-only action or private data.
6. **NOT APPLICABLE - User permissions.** There are no user-owned records or roles in the current release.
7. **PASS - Sanitize user inputs.** Search length is bounded, tickers are normalized, valuation fields use an allowlist and numeric ranges, and URLs displayed by News are limited to HTTP(S).
8. **PASS - XSS.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `document.write` use was found. React escapes rendered text and external links use safe attributes.
9. **PASS - SQL injection.** D1 queries use bound parameters (`sites-app/lib/server/analysis-cache.ts`, `market-data.ts`, and `reference-cache.ts`). Schema identifiers are internal constants rather than request input.
10. **PASS - Database rules.** D1 is available through the server worker binding only; no database credential or client-side database interface is exposed.
11. **PARTIAL - Rate limiting.** Manual refresh is now a POST action with a shared one-minute per-company cooldown and a 429 response (`analysis/route.ts`). Cached reads and refresh leases reduce duplicate work. A broader Cloudflare account-level rate-limit policy cannot be verified from this repository and should be added before high traffic.
12. **NOT APPLICABLE - Spend cap.** Current financial providers are public/free endpoints and no paid AI call is enabled. Revisit this before enabling AI Research or a paid market-data provider.
13. **NOT APPLICABLE - File uploads.** The app has no upload endpoint.
14. **NOT APPLICABLE - CSRF.** No cookie-authenticated user state is changed. Public manual refresh uses POST but does not modify user data.
15. **PASS - CORS.** The standalone FastAPI app has an explicit origin allowlist and is now limited to GET/POST plus the Content-Type header (`backend/app/main.py`). The deployed Sites API is same-origin.
16. **PASS - HTTPS.** The public ChatGPT Sites deployment redirects and serves over HTTPS.
17. **PASS - Security headers.** Worker responses now include CSP frame/base/object/form restrictions, `nosniff`, a strict referrer policy, and a restrictive permissions policy (`sites-app/worker/index.ts`). TLS/HSTS remains platform-managed.
18. **NOT APPLICABLE - Cookies.** AplexAnalysis creates no session cookie. The observed Cloudflare bot-management cookie was Secure and HttpOnly.
19. **PASS - Debug mode.** The production build contains no enabled application debug mode. Vinext's local-only debug page is not a production route.
20. **PASS - Production settings.** Internal cache monitoring is hidden, errors sent to users are bounded, production uses HTTPS, and no development credential is bundled.
21. **NOT APPLICABLE - Brute force.** There are no login, signup, reset, or OTP endpoints.
22. **NOT APPLICABLE - IDOR.** There are no private user objects. Ticker identifiers select public company records only.
23. **PASS - Request sizes.** Search queries are bounded to 80 characters and 20 results. Valuation bodies are limited to 8 KiB while streaming and accept only known fields. Manual refresh bodies are capped and ignored (`valuation/route.ts`, `analysis/route.ts`).

## Quality and polish checks

1. **PASS - Horizontal scroll.** Browser checks at 390 px showed document width equal to viewport width. Wide data tables and the mobile section bar scroll only inside their labelled containers.
2. **PASS - Broken links.** Internal navigation and primary source links were exercised. External links use current provider URLs; third-party availability can still change independently.
3. **PASS - Mobile menu.** The full research navigation becomes a horizontally scrollable mobile bar with the visible hint, “Swipe sideways for more sections.” A hamburger is unnecessary for this terminal layout.
4. **PASS - Favicon.** `/favicon.svg` is configured in `sites-app/app/layout.tsx`.
5. **PASS - Page title.** The title is `AplexAnalysis | Equity Research Terminal`.
6. **PASS - Meta description.** A descriptive search/social summary is configured in `sites-app/app/layout.tsx`.
7. **NOT APPLICABLE - Footer links.** The application-shell design intentionally has no footer.
8. **PASS - Custom 404.** Added a branded, responsive recovery page at `sites-app/app/not-found.tsx`.
9. **NOT APPLICABLE - Copyright year.** No copyright notice is shown.
10. **PARTIAL - Compress images.** Runtime company logos are small remote assets and Vinext optimizes routed images. The 1.6 MB social-preview PNG is not part of normal page loading, so compressing it is a low-priority packaging improvement.
11. **PASS - Broken buttons.** Overview, Valuation, Buy Target, Comps, News, theme, range, refresh, and brand-home interactions are connected; automated tests cover navigation and refresh behavior.
12. **PASS - Success messages.** Manual refresh reports a completed Fresh state.
13. **PASS - Error messages.** Company loads, section loads, price charts, and refresh actions have visible retry/error states.
14. **PASS - Placeholder text.** No unfinished placeholder copy is presented as a finished feature. AI Research is clearly labelled Preview.
15. **PASS - Unused navigation.** All main navigation targets render a page; preview functionality is explicitly labelled.
16. **PASS - Mobile overflow.** No page-level overflow was found at 390 x 844. Wide charts/tables use controlled responsive containers.
17. **PASS - Clickable logo.** The AplexAnalysis brand is now a keyboard-accessible button that returns to the Apple overview (`frontend/components/ResearchTerminal.tsx`).
18. **NOT APPLICABLE - Phone links.** No phone numbers are displayed.
19. **NOT APPLICABLE - Email links.** No email addresses are displayed.
20. **PASS - Mobile optimization.** Touch targets, stacked header, scroll hints, responsive charts, and mobile-contained navigation were verified in a real browser.
21. **PASS - Transitions and active states.** Buttons, tabs, navigation, charts, links, and focus-visible states communicate interaction and selection.
22. **PASS - Dark-mode contrast and consistency.** Dark mode is the coherent default, light mode is available, semantic mint/blue/error colors remain consistent, and controls retain visible focus states.

## Priority fixes remaining

### Critical

None found.

### High

None left in application code.

### Medium

- Configure and verify a Cloudflare account-level rate-limit/WAF policy before promoting the app to high traffic. Repository code now limits manual refreshes, but edge policy lives outside this project.

### Low

- Re-export the social-preview image with stronger PNG compression. It does not affect ordinary app loading.
- Re-run the standalone Python API tests in its provisioned environment. This machine's default Python lacks the project's `httpx` and `pydantic` packages; the deployed Sites app does not use that API.

## Verification performed

- Sites production build, lint, and 62 tests: passed.
- Shared frontend typecheck and 10 tests: passed.
- Production dependency audits for both frontend packages: zero known vulnerabilities after updating the affected transitive package.
- Git tracked-file and history secret scans: no high-signal matches.
- Local browser at desktop and 390 x 844: no React errors, no page-level overflow, navigation and brand-home action worked.
- Local HTTP checks: security headers present; custom 404 returned 404; cache diagnostics returned 404; legacy GET refresh returned 405; oversized valuation returned 413.
