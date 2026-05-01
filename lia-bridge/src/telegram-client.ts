// Telegram Bot API client — send text messages back to a chat

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body}`)
  }
}
