# Skill: Repo To Stax Conversion

## Trigger

Use this skill when converting an upstream GitHub or local application repo into a Taku Stax SubApp.

## Procedure

1. Run `repo-to-stax analyze <repo-or-path>` and read the JSON result.
2. Run `repo-to-stax convert <repo-or-path> --out <dir> --template <absolute-taku-template-path> --name <name>`.
3. Open the generated workspace and read files in this order:
   - `UPSTREAM_CREDITS.md`
   - `STAX_CONVERSION_PLAN.md`
   - `SKILLS.md`
   - `skills/safety-review.md`
   - `upstream-source/README*`
4. Keep the Taku template runtime intact:
   - `taku.manifest.json`
   - `src/__taku/*`
   - `src/app/api/taku/*`
   - `src/lib/proxy/*`
   - `src/lib/actions/*`
5. Choose and state a conversion mode:
   - `converted-preview` for deterministic workflow previews.
   - `prototype-port` for local/sample browser functionality.
   - `live-port` for reviewed server-side live integrations.
   - `blocked-review` when safety/license/service gaps block conversion.
6. Port the smallest complete product workflow first.
7. Move backend logic behind Next.js route handlers or server-only helpers.
8. Add actions only when they map to real product operations. Remove template demo actions unless intentionally kept.
9. Run validation, build, preview, and at least one route/action smoke check before reporting completion.
10. Fill in `SUBAGENT_EXPERIENCE.md`.

## Safety Defaults

- Do not ship live trading, investment advice, private document processing, third-party uploads, hidden scraping, or destructive command execution from a one-pass conversion.
- Do not add client-side API key fields or browser-stored secrets. Use Taku proxy/server-only BYOK when a live path is approved.
- If a repo appears malicious, credential-stealing, phishing-oriented, destructive, or license-blocked, stop and document the reason.

## Pilot Strategies

- `llm-agent-trader`: preserve backtest/report workflow; wrap FastAPI logic behind server routes or actions.
- `openflowkit`: preserve canvas interaction and export flow; prioritize UI fidelity.
- `roomGPT`: preserve image upload/generation/result gallery; use Taku service proxy for AI image calls.
- `last30days-skill`: turn workflow commands into a guided research UI and report viewer.
- `Robby-chatbot`: port Streamlit file upload/chat flow into Next.js with server-side document handling.
