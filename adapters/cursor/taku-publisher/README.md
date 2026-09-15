# Taku Publisher for Cursor

Requires Node.js 20 or later. The bundled Skill uses Cursor's current Agent;
this is an Agent plugin, not a VSIX extension or a separate AI runner.

Invoke `/taku-publisher` in a new Agent chat. For example:

> Scan my last 30 days of Cursor usage, generate a private Stax Card, return its editable Studio URL, and list candidate Skills. Do not publicly publish anything.

First use may require Taku sign-in in the browser. With a valid saved session,
generation proceeds automatically. Authorization completion resumes the same
command; do not start duplicate authorization commands.

Skill publishing and SubApp migration retain separate selection, review and
confirmation steps. Public SubApp release is not supported. Marketplace buyer
Skill installation currently targets Codex, not Cursor.

See the repository's `docs/cursor-release.md` for verified local installation
and release status. No npm release or Cursor Marketplace listing is implied.
