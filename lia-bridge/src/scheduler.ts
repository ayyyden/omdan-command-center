import { schedule } from "node-cron"
import { sendMessage }       from "./crm-client"
import { formatDailySummary } from "./format-response"
import { sendTelegramMessage } from "./telegram-client"

// Exported so index.ts can pass in the already-parsed allowed IDs.
export function startScheduler(allowedIds: Set<number>): void {
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
