import { schedule } from "node-cron"
import { sendMessage, rolloverMetaLeads, syncBank, reviewBank } from "./crm-client"
import { formatDailySummary } from "./format-response"
import { sendTelegramMessage } from "./telegram-client"

// Exported so index.ts can pass in the already-parsed allowed IDs.
export function startScheduler(allowedIds: Set<number>): void {
  // Meta leads rollover and bank sync have no Telegram dependency to start —
  // the daily bank review pushes its digest to Telegram via /notify-action.
  startMetaLeadsRollover()
  startBankSync()

  if (allowedIds.size === 0) {
    console.log("[scheduler] No TELEGRAM_ALLOWED_USER_IDS configured — daily summary disabled")
    return
  }

  // Fire Sun–Fri at 08:00 AM Los Angeles time.  Weekday 0 = Sun, 5 = Fri, 6 = Sat (skipped).
  // noOverlap prevents a second fire if the CRM call takes longer than a minute.
  schedule(
    "0 8 * * 0-5",
    async () => {
      const localNow = new Date().toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: "long", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      })
      console.log(`[scheduler] Daily summary starting — ${localNow}`)

      try {
        const result = await sendMessage({
          message: "What needs my attention today?",
          sender:  "scheduler",
        })

        const text = result.summary
          ? formatDailySummary(result.summary)
          : (result.response_text ?? "No CRM data available right now.")

        for (const chatId of allowedIds) {
          await sendTelegramMessage(chatId, text).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[scheduler] Telegram send failed for ${chatId}: ${msg}`)
          })
        }

        console.log(`[scheduler] Daily summary delivered to ${allowedIds.size} recipient(s)`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("[scheduler] Daily summary failed:", msg)

        const errorText = `Lia — Daily Summary Failed\n\nCould not retrieve CRM data:\n${msg}`
        for (const chatId of allowedIds) {
          sendTelegramMessage(chatId, errorText).catch(() => {})
        }
      }
    },
    {
      timezone:  "America/Los_Angeles",
      noOverlap: true,
    },
  )

  console.log("[scheduler] Daily summary scheduled — Sun–Fri at 08:00 America/Los_Angeles")
}

// Nightly at 12:00 AM Los Angeles time: move every Meta lead in "Second Call
// List" back to the main "Call List" and empty Second Call List. Runs
// independent of Telegram config — it's a pure CRM data job.
function startMetaLeadsRollover(): void {
  schedule(
    "0 0 * * *",
    async () => {
      const localNow = new Date().toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: "long", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      })
      console.log(`[scheduler] Meta leads rollover starting — ${localNow}`)
      try {
        const { moved } = await rolloverMetaLeads()
        console.log(`[scheduler] Meta leads rollover complete — moved ${moved} lead(s) back to Call List`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("[scheduler] Meta leads rollover failed:", msg)
      }
    },
    {
      timezone:  "America/Los_Angeles",
      noOverlap: true,
    },
  )

  console.log("[scheduler] Meta leads rollover scheduled — daily at 00:00 America/Los_Angeles")
}

// Safety-net sync — the primary, near-real-time trigger is Plaid's
// SYNC_UPDATES_AVAILABLE webhook (/api/bank/webhook). This catches anything a
// webhook ever fails to deliver, and retries a connection that's in an error
// state so a transient failure recovers on its own.
//
// Then once a day (6:30pm LA, after the workday's charges have posted) Lia
// sorts everything new and sends ONE digest — expense vs customer payment vs
// skip, business vs which job, category — saved with one tap.
function startBankSync(): void {
  schedule(
    "0 7,14,21 * * *",
    async () => {
      console.log(`[scheduler] Bank sync starting — ${laNow()}`)
      try {
        const result = await syncBank()
        const added = result.results.reduce((sum, r) => sum + r.added, 0)
        const errors = result.results.filter((r) => r.error).map((r) => `${r.institution_name}: ${r.error}`)
        console.log(`[scheduler] Bank sync complete — ${added} new transaction(s)${errors.length ? ` — errors: ${errors.join("; ")}` : ""}`)
      } catch (err: unknown) {
        console.error("[scheduler] Bank sync failed:", err instanceof Error ? err.message : String(err))
      }
    },
    { timezone: "America/Los_Angeles", noOverlap: true },
  )

  schedule(
    "30 18 * * *",
    async () => {
      console.log(`[scheduler] Bank review starting — ${laNow()}`)
      try {
        await syncBank().catch((err) => console.error("[scheduler] pre-review sync failed:", err?.message ?? err))
        const r = await reviewBank()
        console.log(`[scheduler] Bank review complete — ${r.considered} considered, ${r.auto_linked} auto-linked, ${r.proposed} proposed in ${r.batches} digest(s)`)
      } catch (err: unknown) {
        console.error("[scheduler] Bank review failed:", err instanceof Error ? err.message : String(err))
      }
    },
    { timezone: "America/Los_Angeles", noOverlap: true },
  )

  console.log("[scheduler] Bank sync scheduled — 07:00/14:00/21:00, daily review digest 18:30 America/Los_Angeles")
}

function laNow(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  })
}
