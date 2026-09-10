# Editloom

The Phase 1 baseline is a small Node workspace with independently runnable web,
API, and worker processes. It intentionally has no committed credentials and no
provider integration yet.

## Local development

Requires Node.js 18.18 or newer. Copy `.env.example` to `.env` only if local
overrides are needed; the processes use safe development defaults otherwise.

Install workspace links before starting a service:

```sh
npm install
```

## Local PostgreSQL

The API uses PostgreSQL when `DATABASE_URL` is set. Start the local database
and export the development-only connection string before launching the API:

```sh
npm run db:up
export DATABASE_URL=postgresql://editloom:editloom_dev_only@127.0.0.1:5432/editloom
npm run start:api
```

The API applies its idempotent migrations at startup. The compose password is
for local development only; never use it outside a local machine.

```sh
npm run dev:web
npm run dev:api
npm run dev:worker
```

- Web: `http://127.0.0.1:3000/health`
- API: `http://127.0.0.1:3001/health`
- Worker: logs a `worker_ready` event and polls until stopped.

For a one-pass worker smoke test, run `npm run start:worker -- --once`.

## Checks

```sh
npm run lint
npm test
npm run check
```

The baseline uses Node's built-in test runner and syntax linter. `npm run
test:db` exercises the PostgreSQL adapter against a running local database.
