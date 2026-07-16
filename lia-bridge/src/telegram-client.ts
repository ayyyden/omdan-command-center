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

export async function downloadTelegramPhotoBase64(
  fileId: string
): Promise<{ base64: string; mediaType: string }> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getFile`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ file_id: fileId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telegram getFile failed (${res.status}): ${text}`)
  }
  const data = await res.json() as { ok: boolean; result?: { file_path?: string } }
  const filePath = data.result?.file_path
  if (!filePath) throw new Error("Telegram getFile returned no file_path")

  const fileRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`)
  if (!fileRes.ok) throw new Error(`Telegram file download failed (${fileRes.status})`)

  const buffer = await fileRes.arrayBuffer()
  const base64 = Buffer.from(buffer).toString("base64")
  const ext    = filePath.split(".").pop()?.toLowerCase() ?? "jpg"
  const mediaType = ext === "png" ? "image/png" : "image/jpeg"

  return { base64, mediaType }
}
