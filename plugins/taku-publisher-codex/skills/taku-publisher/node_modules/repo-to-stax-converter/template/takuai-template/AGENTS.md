# Taku App Template Agent Rules

## Repository Rules

- Follow `CLAUDE.md` for template architecture and UI conventions.
- Verify relevant changes with the repository's release check, typecheck, lint, and build.
- Keep repository-only agent guidance excluded through `.taku-template.json`; generated-app guidance belongs under `.taku-template/payload/`.
- Treat `src/actions/index.ts` as a registration root that the Host RPC loads only after control authentication succeeds; never statically import it from the RPC route module. Keep Action module top levels registration-only and run database, network, filesystem, or other business effects inside the handler or its server-only domain operation.
- Never put LLM API keys or other secrets in generated Taku Apps; use Taku-managed service/proxy paths.
