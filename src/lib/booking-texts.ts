// The "you're booked" text a customer gets right after an estimate is booked
// (CRM "Add lead" form, website booking), sent from their company's Quo number
// so they recognise it when we call or text later.

import { BRANDS, firstName, type Brand } from "@/lib/appointments"
import { sendQuoSms } from "@/lib/quo-client"

export function bookingConfirmationText(opts: {
  brand:     Brand
  fullName:  string
  when:      string          // already spoken, e.g. "Tuesday, Oct 28 at 10 AM"
  address?:  string | null
  lang?:     "en" | "es"
  visitor?:  string | null   // who comes out; defaults to David
}): string {
  const b = BRANDS[opts.brand]
  // The salesman going (Add lead's PM), else David. "david celuk" -> "David".
  const first = opts.visitor?.trim().split(/\s+/)[0] ?? ""
  const who = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "David"
  const at = opts.address ? (opts.lang === "es" ? ` en ${opts.address}` : ` at ${opts.address}`) : ""
  const name = firstName(opts.fullName)
  return opts.lang === "es"
    ? `${b.name}: ¡Hola ${name}! Su estimado gratis está confirmado para el ${opts.when}${at}. ${who} le avisará cuando vaya en camino. Guarde este número, ${b.phone}, y llame o escriba con cualquier pregunta.`
    : `${b.name}: Hi ${name}! Your free estimate is booked for ${opts.when}${at}. ${who} will text you when heading over. Save this number, ${b.phone}, and call or text with any questions.`
}

export function sendBookingConfirmation(to: string, brand: Brand, text: string) {
  return sendQuoSms(to, text, BRANDS[brand].quoFrom)
}

/** An estimate already booked is given to another salesman: who's coming now. */
export function salesmanChangedText(opts: { brand: Brand; fullName: string; when: string; who: string; lang?: "en" | "es" }): string {
  const b = BRANDS[opts.brand]
  const name = firstName(opts.fullName)
  const hi = name && !/^(lead|new|\[test\]|\+?\d)/i.test(name) ? ` ${name.charAt(0).toUpperCase()}${name.slice(1)}` : ""
  return opts.lang === "es"
    ? `${b.name}: Hola${hi}, su estimado gratis del ${opts.when} será con ${opts.who}. ${opts.who} le avisará cuando vaya en camino. ¿Preguntas? Llame o escriba al ${b.phone}.`
    : `${b.name}: Hello${hi}, your free estimate on ${opts.when} is with ${opts.who}. ${opts.who} will text you when heading over. Questions? Call or text ${b.phone}.`
}
