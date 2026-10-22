# Publisher 0.4.1: automatic material upload recovery

Material start, part and complete requests now retry transient network, rate-limit and server errors automatically, respecting Retry-After. Each operation is bounded to eight attempts and ten minutes. Retries reuse the same material identity and preserve terminal error handling.

The matching Worker release recovers expired creation leases, incomplete verification and lost multipart completion acknowledgments while accounting for capacity once. Existing Sites and assets retain their identity.

Distribution uses the standard two Skills (`taku-publisher`, `taku-sites`) and Codex, Claude and Cursor layouts. The release adds immutable v0.4.1 assets and preserves older releases and the existing GitHub latest pointer. No npm registry or official Cursor store publication is claimed.
