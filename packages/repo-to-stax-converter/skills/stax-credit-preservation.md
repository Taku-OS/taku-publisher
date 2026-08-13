# Skill: Stax Credit Preservation

## Trigger

Use this skill whenever a conversion uses code, README content, UI ideas, workflows, or assets from an upstream repo.

## Rules

1. Never remove `UPSTREAM_CREDITS.md`.
2. Keep upstream `README`, `LICENSE`, `NOTICE`, and attribution files under `upstream-source/`.
3. Keep `taku.manifest.json.stax.upstream` accurate.
4. If the license is `Unknown`, do not publish. Mark the app for review.
5. If a copied asset or code block is materially reused, mention the upstream source in the conversion summary.
6. Do not imply Taku or the converter authored the upstream project.
7. If the conversion is a deterministic preview rather than a live port, say so beside the upstream credit.

## Review Checklist

- `UPSTREAM_CREDITS.md` contains URL, license, detected type, and preservation rules.
- `STAX_CONVERSION_PLAN.md` names the upstream repo.
- Public Stax card/profile metadata can show upstream attribution.
- Generated SubApp still builds after credit files are added.
- `SUBAGENT_EXPERIENCE.md` lists any license or attribution uncertainty.
