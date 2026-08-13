# Skill: Stax Conversion Safety Review

## Trigger

Use this before turning an upstream repo into a live or preview Taku Stax SubApp.

## Stop Conditions

Stop and mark `blocked-review` if the repo appears to enable credential theft, phishing, malware, destructive commands, hidden scraping, evasion, non-consensual surveillance, or other user-harming behavior.

Stop before publish if the license is unknown, missing, incompatible, or carries obligations Taku cannot satisfy yet.

## Checks

- Search for `eval(`, `new Function`, `child_process`, `subprocess`, shell execution, destructive filesystem commands, external uploads, and token/API key handling.
- Do not ask users for client-side API keys or store secrets in browser state, `localStorage`, `sessionStorage`, URLs, or logs.
- For finance/trading repos, avoid investment-advice language, return claims, or live order execution in one-pass conversions.
- For document, resume, image, or chat repos, treat uploads as sensitive and keep previews local/sample-only unless a server-side data policy exists.
- For web, social, or research workflows, avoid hidden credentials, rate-limit bypasses, private data collection, and unsupported factual claims.

## Safer Defaults

- Use `converted-preview` when live behavior needs credentials, Python services, local databases, or third-party uploads.
- Use Next route handlers or server-only helpers for approved live integrations.
- Record unresolved safety decisions in `SUBAGENT_EXPERIENCE.md`.
