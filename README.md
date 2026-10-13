# Northbeam ITSM 2.0

An AI-assisted IT service desk for global teams: React + Vite + Tailwind front end, Node/Express/TypeScript/Prisma/Postgres back end, Socket.io for live updates. Every AI feature has a live-model path (Anthropic API) **and** a deterministic offline path, so the product works fully without an API key and always says which one produced an answer.

## What it borrows from the market leaders

Researched (Sept 2026) against ServiceNow Now Assist and Moveworks, Jira Service Management with Rovo, Freshservice Freddy, Zendesk AI, Salesforce Agentforce IT, SysAid Copilot, Atomicwork, BMC Helix and ManageEngine. "Inspired by" means the same job-to-be-done, not feature parity.

| Capability | Where it lives | Inspired by |
|---|---|---|
| Multilingual triage: category, type, priority, language, sentiment, confidence | `services/ai/classifier.ts` | Now Assist, Freddy, Zendesk |
| Human-in-the-loop threshold: low-confidence tickets go to a triage queue instead of being auto-routed | `services/ticketService.ts`, Admin > AI settings | ServiceNow, Freshservice |
| Explainable skill/workload/shift/SLA-risk routing with admin-tunable weights | `services/assignmentEngine.ts` | ServiceNow predictive routing |
| Self-service answers grounded in the KB (never invented) with "this solved it" tracking | `/ai/deflect`, New ticket page | Moveworks, JSM virtual agent |
| **Employees raise every ticket through the AI assistant**: it answers from the KB, shows suggested articles and duplicate / known-issue warnings, then files the ticket and attaches the chat for the agent | `AssistantChat.tsx`, `virtualAgentController.ts` | Moveworks, Atomicwork, Agentforce |
| Agent copilot: summary, reply drafts (tone), resolution notes, troubleshooting steps, translate, KB article from a resolved ticket | `services/ai/copilot.ts`, Ticket detail | Freddy Copilot, Now Assist, Rovo |
| Duplicate detection and major-incident clustering with alerts | `services/ai/duplicates.ts` | BMC Helix AIOps, ServiceNow |
| Business-hours SLA with time zones, holidays, pause/resume and live meter | `services/sla/*` | ITIL suites |
| Configurable escalation rules, one-shot per ticket, leader-elected across API instances | `services/automation.ts` | ServiceNow flows |
| AI governance: every call logged (provider, latency, tokens, fallback), thumbs feedback, audit trail | Admin > AI governance | ServiceNow AI Control Tower |
| Omnichannel: web, email-in, chat; Slack/Teams/generic outbound webhooks | `miscController.ts`, Integrations | Zendesk, Atomicwork |

## Quick start (local)

```bash
docker run -d --name itsm-db -p 5432:5432 -e POSTGRES_USER=itsm_user -e POSTGRES_PASSWORD=itsm_password -e POSTGRES_DB=itsm postgres:16   # or any Postgres 14+
cd backend && cp .env.example .env && npm install
npx prisma generate && npx prisma migrate deploy
npm run seed                                       # 1 admin, 20 agents, 50 users, 135 tickets, 16 KB articles (resets tables!)
npm run dev                                        # http://localhost:4000
cd ../frontend && npm install && npm run dev       # http://localhost:5173
```

Demo sign-ins after seeding: `admin@itsm.local / Admin@123`, `sarah.johnson@itsm.local / Agent@123`, `user1@itsm.local / User@123`. Remove the seed and the demo buttons in `Login.tsx` before going live.

## Production

```bash
cp .env.example .env      # set POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), PUBLIC_URL
docker compose up -d --build     # web on :8080, API migrates the database on start
```
Put TLS in front (the refresh cookie is `Secure`, `HttpOnly`, `SameSite=Strict` in production). Set `TRUST_PROXY` to the number of proxies. The Docker files were written but not built in the authoring environment; run the first build in CI.

## Environment
See `backend/.env.example`; every variable is validated at boot (`src/config/env.ts`) and the server refuses to start in production with a placeholder secret. Notable: `ANTHROPIC_API_KEY` (blank = offline rules), `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`; set to whichever current model you use), `ANTHROPIC_BASE_URL`, `AI_REDACT_PII`, `ALLOW_REGISTRATION`, `INBOUND_EMAIL_SECRET`, `SMTP_URL`.

## How tickets are raised
- **Employees:** *New ticket* opens the assistant (a chat page), not a form. The assistant searches the knowledge base, answers only from it, lists suggested articles, warns about the employee's own similar open ticket and about issues many colleagues are reporting (counts only), and offers **That solved it** or **Create a ticket**. Files can be attached in the chat. The employee's own words drive classification; the whole conversation is saved on the ticket as an internal note for the agent, and one conversation can create only one ticket.
- **Enforced server-side:** `POST /api/tickets` returns `403 USE_ASSISTANT` for employees, so the chat cannot be bypassed. The only employee path is `POST /api/virtual-agent/chat` then `POST /api/virtual-agent/:id/ticket`.
- **Agents and admins** keep the structured form (category and priority overrides). **Email-in** is unchanged and still creates tickets directly.
- "That solved it" and "ticket created after an answer" feed the self-service deflection rate on the admin dashboard.

## User management (Admin > Users)
- **Add** employees, agents and admins. Leave the password blank to generate a strong one (shown once, never stored in readable form), or choose one. Agents and admins automatically get a staff profile so tickets can be routed to them.
- **Edit** name, email, department, role, team and language; **deactivate** with the toggle (this also signs the person out everywhere).
- **Reset password**: set a specific password or generate one. It signs the user out on every device, clears any lockout, and is audited without the password.
- **Export Excel**: all users (or the current search/role filter) as `.xlsx`: name, email, role, department, team, location, language, time zone, active, last sign-in, created. Password hashes are never exported. Text that looks like a formula is defused.
- **Import**: `.xlsx` or `.csv`, up to 200 rows per file, with a downloadable template (a `Users` sheet to fill in with dropdowns for Role, Language and Active, an `Instructions` sheet, and an orange `Example` sheet with sample rows that is never imported). You always get a **preview** (new / update / skipped / error, with row numbers and reasons) before anything is saved; rows with errors are skipped, valid ones imported. Tick "Update existing users" to change people matched by email (blank cells never overwrite; passwords are never changed by an import). Generated passwords are offered once as a CSV after the import. A 200-row import takes about 5 seconds.
- API: `GET /admin/users/export`, `GET /admin/users/template`, `POST /admin/users/import` (multipart; `dryRun` defaults to true), `POST /admin/users/:id/password`.

## AI safety design
- Ticket text is untrusted: it is wrapped in `<untrusted_data>` tags and the system prompt forbids following instructions inside it. Model output is never executed.
- Structured output is validated with zod and constrained to your real categories and skills. Bad or slow model output degrades to the offline path, never to an error.
- Emails, phone and card numbers are redacted before text leaves the server (`AI_REDACT_PII`).
- Answers are grounded: the assistant may only use retrieved KB articles and must answer `NO_ANSWER` otherwise; the chat then offers a ticket.
- Requesters cannot set priority; only staff can. Requesters never see AI internals, sentiment, internal notes or routing history.
- The UI labels machine output: "AI" (live model) or "Offline rules, no AI model".

## Security
Short-lived access tokens held in memory; rotating refresh tokens in an httpOnly cookie with reuse detection (a replayed token revokes the whole family); lockout after 5 failures; timing-equalised login; password change signs out everywhere; helmet/CSP; per-user AI rate limits; SSRF-guarded webhooks with HMAC signing; upload allow-list with magic-number sniffing; audit log for security and configuration changes.

## Testing
```bash
cd backend && npm test          # 74 unit tests, incl. the live-LLM path against a mock server
cd backend && npm run smoke     # 139 end-to-end checks against a running, seeded API
cd frontend && npm test && npm run build
```

## Known limits and roadmap
- No SSO/SAML/SCIM yet (OIDC is the natural next step), no approvals/change/asset/CMDB modules.
- KB retrieval is in-process BM25: fine to tens of thousands of articles; use pgvector/embeddings beyond that.
- Attachments are on local disk behind `services/storage.ts` (swap for S3/Blob) and are not virus-scanned.
- Socket.io is single-node; add the Redis adapter to run several API instances (automation is already leader-elected).
- Slack/Teams are outbound webhooks only, not interactive bots.
- UI is translated into 8 locales for the employee and agent flows; the admin screens are English. The translations are drafts: get native-speaker review. Arabic renders right-to-left.
- Accessibility was designed in (focus rings, labels, roles, reduced motion, contrast) but has not had an audit with assistive technology.
- Without an AI key, translation is unavailable (returns 503) rather than faked.
