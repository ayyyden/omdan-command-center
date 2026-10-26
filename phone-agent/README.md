# AI phone receptionist (Retell AI)

When nobody answers the Quo line, Quo forwards the call to a Retell number, and the Retell agent picks up. It speaks English or Spanish, answers questions, books free on-site estimates, texts links, confirms appointments and transfers to David.

| Piece | Where |
|---|---|
| Agent prompt / sales script | `phone-agent/prompt.md` |
| Create / update the agent | `node phone-agent/setup.mjs deploy` |
| Agent tools (live during calls) | `src/app/api/retell/{lookup,availability,book,confirm,send-text}` |
| After-call summary (lead note, text to David, transcript email) | `src/app/api/retell/webhook` |
| Day-before reminder texts | `src/app/api/retell/remind`, called by the booking backend |
| Calendar + booking rules | Website booking backend (Apps Script `Code.gs`): same calendar, daily cap and drive-time rules as the website |

## One-time setup

1. **Vercel env vars** (Project → Settings → Environment Variables), then redeploy:
   - `RETELL_TOOL_SECRET`: any long random string.
   - `BOOKING_SCRIPT_URL`: the booking web app URL (`https://script.google.com/macros/s/…/exec`, the same one `assets/booking.js` on the website uses).
   - `BOOKING_PHONE_SECRET`: another long random string.
   - `OWNER_CELL`: David's personal cell, which receives the after-call texts.
   - Already set (check they exist): `QUO_API_KEY`, `QUO_FROM_NUMBER`, `WEBSITE_LEADS_SECRET`, `ASSISTANT_OWNER_EMAIL`, SMTP vars, Google service account vars.
2. **Apps Script** (booking sheet → Extensions → Apps Script):
   - Paste the new `Code.gs`.
   - Add the Script Property `PHONE_AGENT_SECRET` with the same value as `BOOKING_PHONE_SECRET`.
   - Deploy → Manage deployments → edit → New version.
   - Run `installOmdanReminderTrigger` once and approve the permissions.
3. **Create the agent** (from this repo, with `RETELL_API_KEY`, `RETELL_TOOL_SECRET`, `APP_URL`, `OWNER_CELL` in `.env.local`):
   - `node phone-agent/setup.mjs voices male` lists voices with preview links. Pick one that sounds natural in English and Spanish, and put its id in `VOICE_ID`.
   - `node phone-agent/setup.mjs deploy` creates the agent. Run it again after any edit to `prompt.md` to update it.
4. **Retell dashboard:** Phone Numbers → buy a number → set its inbound agent to "Omdan Development receptionist". Then make test calls.
5. **Quo:** Settings → your number → Call forwarding / "When no one answers" (and after-hours) → forward to the Retell number. Use about 4 rings.

`OWNER_CELL` must be David's own cell, never the Quo number. Transferring to the Quo number would forward the call back to the AI.

## Notes
- **Recording disclosure:** the greeting says the call may be recorded, because California requires all-party consent. If a caller sincerely asks whether it's an AI, the agent answers honestly.
- **No prices:** the agent never quotes prices. Pricing questions are turned into booking the free on-site estimate.
- **Reschedules and cancellations:** these aren't automatic yet. The agent takes the request, and the after-call text to David says "To do: …".
