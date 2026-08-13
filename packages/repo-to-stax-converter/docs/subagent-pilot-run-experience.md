# Low-Context Subagent Pilot Run Experience

## Goal

Verify whether low-context coding agents can take an unfamiliar GitHub repo, use the generated converter workspace, and one-shot it into a Taku Stax SubApp without relying on the main thread's repo-specific context.

## Repos Run

| Repo | Result | Code-Level Finding |
| --- | --- | --- |
| `jason8745/llm-agent-trader` | Built a deterministic trading workbench with backtest preview actions. | Useful preview, but the original analyzer labeled it plain `nextjs`; it should be `fastapi-next`. It also kept template demo actions and uses BUY/SELL language that needs no-advice framing. |
| `Vrun-design/openflowkit` | Built a workflow-rich OpenFlowKit UI and product actions. | Good application-layer case for Stax, but it is a product representation, not a full diagram editor/exporter. |
| `Nutlope/roomGPT` | Built an interactive room remodel preview with uploaded object URLs and copied sample assets. | Good direct Next.js case. Live Replicate/Bytescale behavior must stay behind Taku server/proxy policy. |
| `mvanhorn/last30days-skill` | Built a guided research-console preview for the workflow skill. | Good workflow-to-UI case. Live retrieval/scraping must be deferred or explicitly reviewed. |
| `yvann-ba/Robby-chatbot` | Built a Robby document/sheet/YouTube assistant preview with actions. | Action route is present, but the implementation put product actions in `example.ts` and added a client-side API key field. Skills need to forbid this. |

## What Worked

- The converter output gave agents enough local context to keep attribution, find upstream code, and avoid replacing Taku template infrastructure.
- Agents successfully moved beyond the blank scaffold in all five cases.
- `pnpm build`, `repo-to-stax validate`, preview startup, and HTTP smoke checks passed in the subagent reports.
- The best outputs treated the upstream repo as a product workflow and rebuilt that workflow in App Router instead of trying to transplant incompatible stacks.

## What Failed Or Was Ambiguous

- Agents defaulted to deterministic previews because the generated skills did not say when simulation is acceptable.
- Build success did not prove action and UX correctness. Review must include route/action smoke tests and manifest-vs-runtime action alignment.
- The analyzer under-detected nested frameworks because it mostly looked at filenames and root package metadata. It now scans dependency/import content for Streamlit and FastAPI.
- Safety policy was too implicit. Finance, private uploads, API keys, and scraping need explicit stop/defer rules.
- Generated workspaces lacked a standard experience report template, so agents invented different report shapes.

## Updated Converter Guidance

- Generated workspaces now include `skills/safety-review.md`.
- Generated workspaces now include `SUBAGENT_EXPERIENCE.md`.
- `SKILLS.md` now tells agents to choose one of `converted-preview`, `prototype-port`, `live-port`, or `blocked-review`.
- The completion gate now requires at least one product route or action check.
- Analyzer tests cover nested Streamlit and FastAPI + Next.js detection.

## Practical Conclusion

Low-context agents are good enough for first-pass Stax preview generation on application-layer repos, especially UI-heavy apps, Next.js apps, Streamlit apps, and workflow skills. They are not yet reliable for unsupervised live ports. The safe product position is to use this pipeline to generate reviewed `converted-preview` or `prototype-port` SubApps first, then promote selected repos to `live-port` after service, security, and license review.
