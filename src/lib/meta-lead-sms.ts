// "No Answer" follow-up text for Meta Lead Jobs — sent automatically via Quo
// the first time a lead is marked No Answer (falls back to clipboard-copy if
// Quo isn't configured or the send fails).

export type SmsLanguage = "en" | "es"

export function buildNoAnswerSms(fullName: string, language: SmsLanguage = "en"): string {
  const firstName = fullName.split(" ")[0]

  if (language === "es") {
    return `Hola ${firstName}, ¡gracias por contactarnos! Intentamos llamarte pero no logramos comunicarnos. Con gusto podemos coordinar una evaluación gratuita y sin compromiso en el lugar para revisar tu proyecto, hablar sobre opciones de diseño y materiales, y darte un precio exacto. Llámanos o escríbenos cuando te convenga—nos encantaría ayudarte a hacer realidad tus ideas.`
  }

  return `Hi ${firstName}, thank you for reaching out! We tried giving you a call but weren't able to connect. We'd be happy to arrange a free, no-obligation on-site estimate to review your project, discuss design and material options, and provide accurate pricing. Feel free to call or text us back whenever it's convenient—we'd love to help bring your ideas to life.`
}
