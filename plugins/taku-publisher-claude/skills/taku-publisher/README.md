# Taku Publisher portable Skill

This directory is the host-neutral Taku Publisher Skill and Node.js runtime.
Copy the complete `taku-publisher` directory into the Skill directory used by
the host. Keep its bundled `node_modules` directory intact.

The portable package supports Cursor through its current Agent and the bundled
CLI. It can discover the current project, recent Cursor workspaces, and exact
local Cursor token counts when Cursor has recorded them. Missing token counts
are reported as unavailable and are never estimated from conversation text.

Other compatible hosts can use an explicit local project and the same CLI. The
host must support Skills and provide the Agent that performs semantic migration;
this package does not contain or launch an independent AI runner.
