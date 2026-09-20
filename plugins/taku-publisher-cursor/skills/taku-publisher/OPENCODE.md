# Taku Publisher for OpenCode

OpenCode loads Taku Publisher as a standard Agent Skill. The adapter build
creates a self-contained portable Skill at `dist/skills/taku-publisher`.

Install that directory as `taku-publisher` under either OpenCode's global
`~/.config/opencode/skills/` directory or a project's `.opencode/skills/`
directory. OpenCode also discovers the same Skill from compatible `.agents`
and `.claude` Skill directories.

The portable Skill includes the Node.js runtime needed for Stax Card creation,
project assessment, App-to-Taku SubApp conversion, Creator Center access, and
Skill publishing. Node.js 20 or newer is required. Recent-project discovery
reads only project paths and activity timestamps from OpenCode's local state.
Usage statistics use only explicit per-session model and token counters; the
Publisher never queries OpenCode message, prompt, account, or credential tables
and never estimates missing usage.
