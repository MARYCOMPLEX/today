# Repository instructions

## Invariants

- D1 is the only source of truth for users, sessions, invitations, API keys, WeChat bindings, settings, and pending notification metadata.
- The fixed-name `gateway` Durable Object schedules and serializes iLink work. It must not become a second durable business store.
- R2 stores only pending image bytes. D1 owns the reference. Delete the D1 queue row after a successful send, then delete the R2 object.
- An API key identifies exactly one user. API callers never choose a WeChat recipient.
- A user has one current API key and one WeChat binding.

## Boundaries

- Validate external input once at the HTTP boundary.
- Supported image signatures are JPEG, PNG, and WebP. SVG and mislabeled files are rejected with HTTP 415.
- The service image limit is 20 MiB. Do not raise it without a Workerd memory spike; AES upload holds plaintext and ciphertext concurrently.
- Text is passed to iLink unchanged. Do not add a Markdown sanitizer unless a verified client incompatibility requires it.
- Provider-specific AES/CDN/message shapes stay in `src/image.ts` and `src/ilink.ts`.
- Append D1 migrations. Never edit an already deployed migration.

## Secrets and local state

- Runtime secrets live in the gitignored root `.dev.vars`, following Wrangler convention.
- The real `wrangler.jsonc` is gitignored; `wrangler.example.jsonc` is the public template.
- Non-runtime private notes and consumed bootstrap artifacts belong under `.local/`.
- Never print or log passwords, API keys, bot tokens, context tokens, upload URLs, AES keys, or invitation tokens.
- `bun run secrets:push` uploads only `BETTER_AUTH_SECRET` and `MASTER_KEY`; admin credentials and `MY_API_TOKEN` remain local.

## Verification

Run before commit or deploy:

```bash
bun run check
bun run cf:dry-run
```

For database changes, apply migrations to a fresh or current local D1 and exercise the boundary API. For production changes, verify `/health`, `/docs`, authentication, and the affected endpoint after deploy.

## Runtime safety

- Use structured logs with request ID, user ID, binding generation, and notification ID.
- Never hold a 35-second iLink poll inside `blockConcurrencyWhile`.
- Process at most four user polls concurrently per round.
- Preserve error causes and leave queued R2 objects intact when delivery fails.
