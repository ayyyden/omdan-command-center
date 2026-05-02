// Parses natural language contract-send requests into structured data.

export interface ParsedContractMessage {
  customer_name: string | null
  job_title_hint: string | null
  template_name_hint: string | null
  bundle_all: boolean
}

export function parseContractMessage(text: string): ParsedContractMessage {
  const lower = text.toLowerCase().trim()

  // Strip "Lia" prefix
  const working = lower.replace(/^lia[,\s]*/i, "")

  // Detect bundle/all mode
  const bundle_all =
    /\ball\s+required\b/.test(working) ||
    /\bcontract\s+bundle\b/.test(working) ||
    /\bbundle\b/.test(working) ||
    /\ball\s+contracts\b/.test(working)

  // Extract template name hint: "send [HINT] contract" where HINT is not a stop word
  let template_name_hint: string | null = null
  if (!bundle_all) {
    const templateMatch = working.match(/\bsend\s+(?:a\s+|the\s+|an\s+)?(.+?)\s+contracts?\b/)
    if (templateMatch?.[1]) {
      const hint = templateMatch[1].trim()
      const stopWords = new Set(["a", "the", "an", "this", "that", "one", "some"])
      if (hint && !stopWords.has(hint)) {
        template_name_hint = hint
      }
    }
  }

  // Extract customer name and job hint using "to [CUSTOMER] for [JOB]" pattern
  const toForMatch = text.match(/\bto\s+(.+?)\s+for\s+(?:the\s+|his\s+|her\s+|their\s+)?(.+)/i)
  let customer_name: string | null = null
  let job_title_hint: string | null = null

  if (toForMatch) {
    customer_name  = toForMatch[1]?.trim() || null
    job_title_hint = toForMatch[2]?.trim().replace(/[,.]$/, "").trim() || null
  }

  return { customer_name, job_title_hint, template_name_hint, bundle_all }
}
