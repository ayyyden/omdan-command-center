// Creates or updates the Omdan AI phone receptionist in Retell AI.
//
//   node phone-agent/setup.mjs voices    list voices (pick one for VOICE_ID)
//   node phone-agent/setup.mjs deploy    create/update the LLM + agent from prompt.md
//
// Reads env vars (put them in .env.local; this script loads it):
//   RETELL_API_KEY       Retell dashboard -> API Keys
//   RETELL_TOOL_SECRET   same value as in Vercel (tools + webhook send it)
//   APP_URL              e.g. https://omdan-command-center.vercel.app
//   OWNER_CELL           David's personal cell for transfers (NOT the Quo number: that would loop)
//   VOICE_ID             from `voices`
//   AGENT_NAME           optional, the name the receptionist uses (default "Daniel")
//   RETELL_LLM_MODEL     optional (default "claude-5.5-sonnet")
//   RETELL_VOICE_MODEL   optional (default "eleven_flash_v2_5")
// The created ids are saved in phone-agent/retell-ids.json so the next deploy updates in place.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, "..", ".env.local")
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const API = "https://api.retellai.com"
const env = (k, fallback) => {
  const v = process.env[k] ?? fallback
  if (v === undefined || v === "") { console.error(`Missing ${k}`); process.exit(1) }
  return v
}

async function retell(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${env("RETELL_API_KEY")}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${text.slice(0, 1000)}`)
  return text ? JSON.parse(text) : {}
}

async function listVoices() {
  const voices = await retell("GET", "/list-voices")
  const rows = voices
    .filter((v) => !process.argv[3] || JSON.stringify(v).toLowerCase().includes(process.argv[3].toLowerCase()))
    .map((v) => `${v.voice_id.padEnd(34)} ${String(v.provider).padEnd(11)} ${String(v.gender).padEnd(7)} ${String(v.accent ?? "").padEnd(12)} ${v.voice_name}${v.preview_audio_url ? `  ${v.preview_audio_url}` : ""}`)
  console.log(rows.join("\n"))
  console.log(`\n${rows.length} voices. Filter: node phone-agent/setup.mjs voices male`)
}

function allTools(appUrl, secret, ownerCell) {
  const headers = { "x-retell-secret": secret }
  const lang = { type: "string", enum: ["en", "es"], description: "Language the call is in" }
  const custom = (name, route, description, properties, required, speak) => ({
    type: "custom", name, description, url: `${appUrl}/api/retell/${route}`, method: "POST", headers,
    parameters: { type: "object", properties: { ...properties, language: lang }, required },
    speak_during_execution: !!speak, execution_message_description: speak, execution_message_type: "prompt",
    speak_after_execution: true, timeout_ms: 25000,
  })
  return {
    lookup: custom("lookup_caller", "lookup",
      "Look up the caller by phone number to see if they're a past lead, have an upcoming estimate, or are a customer with a job. Call once, early in the call.",
      { phone: { type: "string", description: "Phone number if different from caller ID, else omit" } }, []),
    availability: custom("check_availability", "availability",
      "Get open times for a free on-site estimate at the caller's ZIP code (also for rescheduling). Also says if the ZIP is outside our service area.",
      {
        zip:            { type: "string", description: "5-digit ZIP code of the property" },
        brand:          { type: "string", enum: ["omdan", "desert_green"], description: "Company of the appointment when rescheduling (from lookup_caller / the call details); omit for new Omdan bookings" },
        preferred_date: { type: "string", description: "YYYY-MM-DD if the caller asked for a specific day" },
        part_of_day:    { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
      }, ["zip"], "Briefly say you're looking at the calendar, e.g. 'One sec, let me pull up the calendar.'"),
    book: custom("book_estimate", "book",
      "Book the free on-site estimate once the caller picked a time from check_availability and you've confirmed their details.",
      {
        full_name:       { type: "string", description: "First and last name" },
        phone:           { type: "string", description: "Best cell number (caller ID if they confirmed it)" },
        street:          { type: "string", description: "Street address, e.g. 123 Main St" },
        city:            { type: "string" },
        zip:             { type: "string", description: "5-digit ZIP" },
        date:            { type: "string", description: "Exact date value from check_availability, YYYY-MM-DD" },
        time:            { type: "string", description: "Exact time value from check_availability, HH:mm" },
        services:        { type: "array", items: { type: "string", enum: ["turf", "pavers", "concrete", "gravel", "full-remodel", "pool", "kitchen", "bathroom", "windows", "roofing", "insulation", "hvac", "gutters", "plumbing", "painting", "cool-life-paint"] } },
        start:           { type: "string", enum: ["asap", "1-3", "3plus", "planning"], description: "When they want to start" },
        project_summary: { type: "string", description: "One sentence with the useful project details" },
      }, ["full_name", "street", "city", "zip", "date", "time", "services"],
      "Say you're locking it in, e.g. 'Perfect, let me lock that in for you.'"),
    confirm: custom("confirm_appointment", "confirm",
      "Mark the customer's upcoming estimate as confirmed. Use the appointment_ref you were given.",
      { appointment_ref: { type: "string" } }, ["appointment_ref"]),
    reschedule: custom("reschedule_appointment", "reschedule",
      "Move the customer's upcoming estimate to a new time they picked from check_availability.",
      {
        appointment_ref: { type: "string" },
        new_date:        { type: "string", description: "Exact date value from check_availability, YYYY-MM-DD" },
        new_time:        { type: "string", description: "Exact time value from check_availability, HH:mm" },
      }, ["appointment_ref", "new_date", "new_time"], "Say you're moving it, e.g. 'Perfect, let me move that for you.'"),
    cancel: custom("cancel_appointment", "cancel",
      "Cancel the customer's upcoming estimate. ONLY after you offered to reschedule and they still don't want it.",
      {
        appointment_ref:    { type: "string" },
        reason:             { type: "string", description: "Why they're cancelling, in a few words" },
        offered_reschedule: { type: "boolean", description: "True only if you already offered to reschedule and they declined" },
      }, ["appointment_ref", "offered_reschedule"]),
    sendText: custom("send_text", "send-text",
      "Text the caller links (website, estimate, projects, reviews, license, or a service page) and/or a short note, from Omdan's business number.",
      {
        phone: { type: "string", description: "Number to text if different from caller ID" },
        links: { type: "array", items: { type: "string", enum: ["website", "estimate", "projects", "reviews", "license", "turf", "pavers", "concrete", "gravel", "pool", "kitchen", "bathroom", "windows", "roofing", "insulation", "hvac", "gutters", "plumbing", "painting", "cool-life-paint"] } },
        note:  { type: "string", description: "Optional short note, e.g. 'Text photos of your yard to this number.'" },
      }, []),
    transfer: {
      type: "transfer_call", name: "transfer_to_david",
      description: "Transfer the call to David (owner) when the rules in the prompt say to.",
      transfer_destination: { type: "predefined", number: ownerCell },
      transfer_option: { type: "cold_transfer", show_transferee_as_caller: true },
      speak_during_execution: true,
      execution_message_description: "Tell them you're getting David on the line, one moment.",
      execution_message_type: "prompt",
    },
    end: { type: "end_call", name: "end_call", description: "End the call after saying goodbye, or for spam/robocalls." },
  }
}

function tools(appUrl, secret, ownerCell) {
  const t = allTools(appUrl, secret, ownerCell)
  return [t.lookup, t.availability, t.book, t.confirm, t.reschedule, t.cancel, t.sendText, t.transfer, t.end]
}

function confirmTools(appUrl, secret, ownerCell) {
  const t = allTools(appUrl, secret, ownerCell)
  return [t.availability, t.confirm, t.reschedule, t.cancel, t.transfer, t.end]
}

const CONFIRM_POST_CALL = [
  { type: "boolean", name: "reached_customer", description: "True if you spoke with the customer (not voicemail, not someone else, not no answer)" },
  { type: "string",  name: "outcome",          description: "One of: confirmed, rescheduled, cancelled, no_decision, voicemail, wrong_person" },
]

const POST_CALL = [
  { type: "string",  name: "caller_name",        description: "Caller's full name if given, else empty" },
  { type: "string",  name: "project",            description: "Short description of the project (service + details), else empty" },
  { type: "string",  name: "city_or_zip",        description: "City and/or ZIP of the property, else empty" },
  { type: "boolean", name: "appointment_booked", description: "True if a free estimate was booked on this call" },
  { type: "boolean", name: "needs_callback",     description: "True if David should call this person back" },
  { type: "string",  name: "action_for_owner",   description: "What David needs to do, e.g. 'Call back about warranty on pool job' or 'Reschedule to Thursday afternoon'. Empty if nothing." },
  { type: "string",  name: "language",           description: "English or Spanish" },
]

async function deploy() {
  const appUrl = env("APP_URL").replace(/\/$/, "")
  const secret = env("RETELL_TOOL_SECRET")
  const ownerCell = env("OWNER_CELL")
  const agentName = env("AGENT_NAME", "Daniel")
  const idsFile = path.join(here, "retell-ids.json")
  const ids = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, "utf8")) : {}

  const prompt = fs.readFileSync(path.join(here, "prompt.md"), "utf8").replaceAll("{{agent_name}}", agentName)
  const model = env("RETELL_LLM_MODEL", "claude-5.5-sonnet")
  const llmBody = {
    general_prompt: prompt,
    start_speaker:  "agent",
    begin_message:  `Thanks for calling Omdan Development, this is ${agentName}. Just so you know, this call may be recorded. How can I help you today?`,
    general_tools:  tools(appUrl, secret, ownerCell),
    model_config:   { type: "cascading", primary: { model }, temperature: 0.4 },
  }

  const llm = ids.llm_id
    ? await retell("PATCH", `/update-retell-llm/${ids.llm_id}`, llmBody)
    : await retell("POST", "/create-retell-llm", llmBody)
  ids.llm_id = llm.llm_id
  console.log(`LLM ${ids.llm_id} ${ids.agent_id ? "updated" : "created"}`)

  const agentBody = {
    agent_name:          "Omdan Development receptionist",
    response_engine:     { type: "retell-llm", llm_id: ids.llm_id },
    voice_id:            env("VOICE_ID"),
    voice_model:         env("RETELL_VOICE_MODEL", "eleven_flash_v2_5"),
    language:            ["en-US", "es-ES"],
    voice_temperature:   1,
    voice_speed:         1,
    responsiveness:      0.9,
    interruption_sensitivity: 0.8,
    enable_backchannel:  true,
    backchannel_words:   ["mm-hm", "yeah", "got it", "okay", "ajá", "claro"],
    ambient_sound:       null,
    denoising_mode:      "noise-and-background-speech-cancellation",
    boosted_keywords:    ["Omdan", "pavers", "turf", "Cool Deck", "Cool Life", "xeriscape", "Palm Springs", "Palm Desert",
                          "Rancho Mirage", "Cathedral City", "Indio", "La Quinta", "Yucca Valley", "Twentynine Palms", "Yucaipa",
                          "Moreno Valley", "Menifee", "Murrieta", "Temecula", "San Bernardino", "Desert Hot Springs"],
    end_call_after_silence_ms: 30000,
    max_call_duration_ms: 1800000,
    reminder_trigger_ms: 9000,
    webhook_url:         `${appUrl}/api/retell/webhook?secret=${encodeURIComponent(secret)}`,
    webhook_events:      ["call_analyzed"],
    post_call_analysis_data: POST_CALL,
  }

  const agent = ids.agent_id
    ? await retell("PATCH", `/update-agent/${ids.agent_id}`, agentBody)
    : await retell("POST", "/create-agent", agentBody)
  ids.agent_id = agent.agent_id
  fs.writeFileSync(idsFile, JSON.stringify(ids, null, 2) + "\n")
  console.log(`Agent ${ids.agent_id} ready.`)

  // Confirmation calls (outbound): own prompt + tools, same voice and webhook.
  const confirmLlmBody = {
    general_prompt: fs.readFileSync(path.join(here, "confirm-prompt.md"), "utf8").replaceAll("{{agent_name}}", agentName),
    start_speaker:  "user",
    begin_after_user_silence_ms: 2000,
    general_tools:  confirmTools(appUrl, secret, ownerCell),
    model_config:   { type: "cascading", primary: { model }, temperature: 0.3 },
  }
  const confirmLlm = ids.confirm_llm_id
    ? await retell("PATCH", `/update-retell-llm/${ids.confirm_llm_id}`, confirmLlmBody)
    : await retell("POST", "/create-retell-llm", confirmLlmBody)
  ids.confirm_llm_id = confirmLlm.llm_id
  const confirmAgentBody = {
    ...agentBody,
    agent_name:      "Omdan confirmation calls",
    response_engine: { type: "retell-llm", llm_id: ids.confirm_llm_id },
    post_call_analysis_data: CONFIRM_POST_CALL,
    end_call_after_silence_ms: 20000,
    max_call_duration_ms: 600000,
  }
  const confirmAgent = ids.confirm_agent_id
    ? await retell("PATCH", `/update-agent/${ids.confirm_agent_id}`, confirmAgentBody)
    : await retell("POST", "/create-agent", confirmAgentBody)
  ids.confirm_agent_id = confirmAgent.agent_id
  fs.writeFileSync(idsFile, JSON.stringify(ids, null, 2) + "\n")
  console.log(`Confirmation agent ${ids.confirm_agent_id} ready.`)

  if (process.env.RETELL_FROM_NUMBER) {
    await retell("PATCH", `/update-phone-number/${encodeURIComponent(process.env.RETELL_FROM_NUMBER)}`, { outbound_agent_id: ids.confirm_agent_id })
    console.log(`Outbound calls from ${process.env.RETELL_FROM_NUMBER} use the confirmation agent.`)
  }
}

const cmd = process.argv[2]
if (cmd === "voices") await listVoices()
else if (cmd === "deploy") await deploy()
else console.log("Usage: node phone-agent/setup.mjs voices [filter] | deploy")
