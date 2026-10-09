# Taku Publisher native marketplace candidate

Version **0.3.30**, Publisher-only profile. Source: `ec978d42bb34c395ff7e2a58f5f4f60c4f1dd557`; dirty: false.

Three native plugins support the existing Card → candidate Skill → scan/review/package → private draft → Taku Web confirmation flow. Only `taku-publisher` is registered as a Skill. The shared runtime is retained from main for compatibility; Sites eligibility remains restricted by the server. This update does not enable Sites GA or include the Sites Skill.

Install from the `marketplace` branch after its separately reviewed promotion:

- Codex: `codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace`, then `codex plugin add taku-publisher@taku`.
- Claude Code: `claude plugin marketplace add Taku-OS/taku-publisher@marketplace`, then `claude plugin install taku-publisher@taku`.
- Cursor: import this branch using `.cursor-plugin/marketplace.json`.

Start a new Agent session after a user-approved install/update. First-use production browser login and public Skill release require acceptance; local simulations do not verify them. Final public release requires confirmation on Taku Web.

`release.json` records each file and host archive SHA-256. Source release notes and the Kristen acceptance checklist live in `docs/release-0.3.30-native.md` on the reviewed source branch. Retain the previous marketplace commit and host archive for rollback; do not describe old Sites credentials as a verified rollback.
