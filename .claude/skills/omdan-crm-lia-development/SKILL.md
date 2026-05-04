---
name: omdan-crm-lia-development
description: >
  Load Omdan Command Center CRM + Lia assistant project rules before making changes.
  Use when working on any feature, bug fix, or deployment task in this repo.
user-invocable: true
---

You are working on the **Omdan Command Center** project. Read and internalize all rules below before making any changes.

## Project Overview

- **Omdan Command Center** is a Next.js + Supabase CRM for Omdan Development.
- The main repo is `omdan-command-center`.
- The CRM deploys to **Vercel** automatically from pushes to `main`.
- **Lia bridge** is a Node/Express TypeScript app in `lia-bridge/`.
- Lia bridge runs on a **VPS** — not Railway, not Fly.io.

## VPS / Lia Bridge Deployment Rules

- VPS path: `/opt/lia-bridge`
- Safe deploy script: `/root/deploy-lia-bridge.sh`
- `/opt/lia-bridge` is **NOT a Git repo** — never `git pull` inside it.
- **Never delete or overwrite `/opt/lia-bridge/.env`.**
- To deploy Lia bridge changes:
  1. Copy `lia-bridge/src/`, `package.json`, `package-lock.json`, and `tsconfig.json` from Windows to `/opt/lia-bridge`.
  2. Run `/root/deploy-lia-bridge.sh`.
- To deploy CRM changes: push to GitHub `main` — Vercel auto-deploys.
- Do not mention Railway or Fly.io unless the user explicitly says the deployment changed.

## Lia Behavior

- Lia is the **Telegram CRM assistant**.
- Lia works in private DMs and in approved Telegram groups.
- `TELEGRAM_ALLOWED_USER_IDS` — controls which users can send Lia commands.
- `TELEGRAM_ALLOWED_CHAT_IDS` — controls which groups are approved.
- **CRM event notifications** (estimate approved, contract signed, etc.) go to the approved Telegram group only (`TELEGRAM_ALLOWED_CHAT_IDS`).
- **Daily scheduled summary** goes to private DMs only (uses `TELEGRAM_ALLOWED_IDS`/user IDs).
- Follow-up memory must be scoped by `chat.id + from.id`.

## Approval-Required Actions

These actions **must always go through the approval-first flow** — never execute directly:

- Creating or sending estimates
- Creating or sending invoices
- Sending contracts
- Scheduling jobs
- Sending customer emails or messages
- Changing money or prices
- Changing job or customer records

## Never-Do-Without-Approval Actions

Even with a user request, these require explicit approval before execution:

- Sending customer emails
- Sending contracts
- Sending invoices
- Marking invoices paid
- Deleting or archiving anything
- Changing permissions
- Exposing secrets or credentials

## Professional Writing Rules

- Users may write short or messy English — Lia must understand and rewrite customer-facing text professionally.
- **Rule: expand the language, not the commitment.**
- Do NOT invent: brands, warranties, permits, engineering specs, measurements, material specs, timelines, or extra services — unless explicitly provided by the user.
- Professionalize all of the following:
  - Project titles
  - Scopes of work
  - Payment schedule labels
  - Email subjects and bodies
  - Invoice notes
  - Contract previews

### Payment Label Standards

| Raw input | Professional label |
|---|---|
| "deposit" | Deposit |
| "material arrive" / "materials arrive" | Upon Material Arrival |
| "material delivery" | Upon Material Delivery |
| "start" / "begin" / "mobilization" | Upon Project Start |
| "done" / "job done" / "rest" / "remainder" / "final" / "balance" / "completion" | Final Payment Upon Completion |
| "progress" / "midway" / "halfway" | Progress Payment |

## Data and Business Rules

- Invoices require a `job_id`.
- Contracts should require a `job_id` unless the user explicitly requests a customer-level or general contract.
- If multiple customers, jobs, or templates match — ask the user with buttons to disambiguate.
- If required fields are missing — ask exactly one clean follow-up question.
- Customer-facing public routes (signing, approval) must **not** redirect to login.

## Technical Rules

- TypeScript must compile without errors before any change is considered complete.
- Do not break these existing flows:
  - lead → estimate → PDF email
  - professional scope generation
  - invoice flow + invoice PDF attachment
  - job scheduling
  - contract sending / signing
  - Telegram group support
  - daily summary
  - immediate event notifications
  - public approval and signing routes
- Reuse existing helpers and routes where possible.
- Do not redesign systems unrelated to the current task.
- No database migrations unless required — explain why before adding one.
- Preserve security and approval-first behavior in all paths.

## Architecture Reminders

- Service client (`createServiceClient()`) bypasses RLS — use it in assistant/execute routes.
- Contract parser uses three-priority name extraction: (1) "to NAME for JOB", (2) "to NAME" at end, (3) "contract NAME" at end.
- Pending follow-up state is stored in in-memory Maps keyed by `${chatId}:${fromId}`.
- `normalizePaymentLabel` lives in `src/lib/lia-text-normalizer.ts` and `lia-bridge/src/lead-parser.ts`.
- Pre-generated title/scope is stored in the approval payload — reuse it in the execute route instead of calling Claude again.
