// Telegram Bot API client

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!

export interface InlineKeyboardButton {
  text: string
  callback_data: string
}

async function tgPost(method: string, body: unknown): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telegram ${method} failed (${res.status}): ${text}`)
  }
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  await tgPost("sendMessage", { chat_id: chatId, text })
}

export async function sendTelegramWithButtons(
  chatId: number,
  text: string,
  buttons: InlineKeyboardButton[][]
): Promise<void> {
  await tgPost("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: buttons },
  })
}
