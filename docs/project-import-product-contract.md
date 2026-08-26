# Codex and Claude Code project import contract

## Product boundary

Taku Publisher can discover recent local workspaces referenced by Codex and
Claude Code sessions, but discovery is not authorization to inspect source.
The creator selects one exact project before Publisher performs read-only
assessment.

Project import is an orchestration layer over existing Taku capabilities:

| Route | Meaning | Next boundary |
| --- | --- | --- |
| `existing-skill` | A root `SKILL.md` already exists | Existing Skill publish flow |
| `subapp-migration` | A supported interactive application was detected | Existing confirmed SubApp flow |
| `skill-generation` | A repeatable local workflow needs a bounded Skill wrapper | Isolated Skill candidate flow |
| `reference-only` | Runtime or authority is unsupported | Stop or retain as a reference |

## Discovery privacy

`project-discover` reads only the session records needed to recover absolute
workspace paths and activity timestamps. Prompt and message bodies are not
returned, summarized, uploaded, or used for project classification. Discovery
performs only lightweight root metadata inspection (`SKILL.md`, `README.md`,
`package.json`, framework dependency names) after confirming that the referenced
workspace still exists.

The command rejects filesystem roots, the whole home directory, symlink
workspaces, missing directories, and paths that do not occur in supported local
session metadata. The creator must select one project before assessment.

## Skill generation boundary

An eligible `skill-generation` assessment returns a confirmation token bound to
the canonical source path, Converter source digest, detected project identity,
route, reasons, and risks. `skill-prepare` reassesses the source and rejects a
missing, stale, or mismatched token.

Preparation creates one new child beneath an explicit existing output root. It
writes a placeholder `SKILL.md` and a private local
`.taku/skill-conversion.json` record. It does not modify or execute the source,
start an Agent, install dependencies, upload, publish, register, or install the
candidate.

`skill-convert` returns a bounded handoff for the current Codex or Claude Agent:

- source project and `.taku` record are read-only;
- only candidate `SKILL.md`, `scripts/`, `references/`, and `assets/` are
  editable;
- credentials, environment files, caches, build output, and absolute local
  paths may not be copied;
- source scripts may not be executed during conversion.

`skill-conversion-check` verifies the source digest, candidate file boundary,
frontmatter, placeholder removal, minimum workflow instructions, secret-bearing
file types, and source-path leakage. It is static and executes no candidate
scripts. A pass advances to the existing Skill staging and security review
flow; it is not publication authority.

The private `.taku/skill-conversion.json` record is excluded from immutable
Publisher staging and the public Skill package.

## MVP acceptance

1. Codex and Claude Code fixtures discover and deduplicate one shared project.
2. Discovery output contains no prompt content.
3. Existing Skills and supported interactive Apps route to their current flows.
4. A safe Python/CLI workflow can prepare an isolated Skill candidate after
   exact confirmation.
5. Source changes invalidate confirmation and candidate validation.
6. Static validation blocks placeholders, invalid frontmatter, secret files,
   symlinks, oversized candidates, and absolute source-path leakage.
7. Publisher staging excludes the private conversion record.
