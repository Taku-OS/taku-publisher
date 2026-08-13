# Skill: Pilot Repo Playbook

## Trigger

Use this skill when working on one of the first five Stax converter pilot repos.

## Pilot Repos

### jason8745/llm-agent-trader

Goal: convert a full-stack AI trading/backtesting repo into a Taku SubApp. Preserve the analysis/backtest/report loop. Prefer server routes or Taku actions for expensive runs.

Safety: one-pass output should be educational preview only. Do not add live orders, return claims, or investment-advice phrasing.

### Vrun-design/openflowkit

Goal: convert an interactive diagramming app. Prioritize canvas usability, local-first state, export, and a clear "Try it on Taku" story.

Safety: keep local-first behavior. Do not introduce external export/upload services without a reviewed server boundary.

### Nutlope/roomGPT

Goal: direct Next.js conversion. Preserve image upload, generation prompt, result comparison, and gallery/history. Replace external model keys with Taku proxy/service routes.

Safety: room photos are private user content. A preview can use object URLs/sample assets; live generation needs explicit storage, retention, and provider boundaries.

### mvanhorn/last30days-skill

Goal: wrap a research skill/workflow as UI. Build topic input, run progress, source list, report view, and export. Keep command semantics visible in actions.

Safety: avoid hidden scraping credentials and unsupported factual claims. Preview mode should clearly say that live retrieval is deferred.

### yvann-ba/Robby-chatbot

Goal: port Streamlit chatbot UX. Build file/video URL upload, ingestion status, chat, source snippets, and reset/export actions.

Safety: documents and resumes may contain sensitive personal data. Do not ask for client-side API keys or send uploads to external providers without a server-only policy.

## Common Done Definition

- Core workflow works in the browser.
- Upstream credit is intact.
- `repo-to-stax validate` passes.
- `pnpm build` passes.
- At least one product action or route is exercised.
- Stax metadata identifies upstream repo and conversion status.
- `SUBAGENT_EXPERIENCE.md` records missing context, safety decisions, and skill improvements.
