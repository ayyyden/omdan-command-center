// Parses natural language contract-send requests into structured data.
// Handles both strict formats ("send contract to John Smith for paver job")
// and natural phrasing ("i need to send a contract to idan slik").

export interface ParsedContractMessage {
  customer_name: string | null
  job_title_hint: string | null
  template_name_hint: string | null
  bundle_all: boolean
  customer_level: boolean
}

export function parseContractMessage(text: string): ParsedContractMessage {
  // Strip "Lia" prefix and common leading softeners so the real command is clean
  let working = text.trim()
  working = working.replace(/^lia[,\s]*/i, "")
  working = working.replace(
    /^(?:i\s+(?:need|want|would\s+like)\s+(?:to\s+|you\s+to\s+)|please\s+|can\s+you\s+|could\s+you\s+)/i,
    "",
  )
  const lower = working.toLowerCase()

  // Detect bundle / all mode
  const bundle_all =
    /\ball\s+required\b/.test(lower) ||
    /\bcontract\s+bundle\b/.test(lower) ||
    /\bbundle\b/.test(lower) ||
    /\ball\s+contracts\b/.test(lower)

  // Detect customer-level / general contract (no job required)
  const customer_level =
    /\bcustomer[- ]?level\b/.test(lower) ||
    /\bgeneral\s+contract\b/.test(lower)

  // Extract template name hint: words between "send" and "contract[s]" that aren't articles
  let template_name_hint: string | null = null
  if (!bundle_all) {
    const templateMatch = lower.match(/\bsend\s+(?:a\s+|the\s+|an\s+)?(.+?)\s+contracts?\b/)
    if (templateMatch?.[1]) {
      const hint = templateMatch[1].trim()
      const stopWords = new Set(["a", "the", "an", "this", "that", "one", "some", "me", "us"])
      if (hint && !stopWords.has(hint)) {
        template_name_hint = hint
      }
    }
  }

  // Extract customer_name and job_title_hint.
  // Name words must not be "for" (prevents greedy over-capture).
  const NAME_WORD = "[A-Za-z][A-Za-z'-]+"
  const MORE_WORDS = `(?:\\s+(?!for\\b)${NAME_WORD}){0,3}`
  const NAME_PAT = `(${NAME_WORD}${MORE_WORDS})`

  let customer_name: string | null = null
  let job_title_hint: string | null = null

  // Priority 1: "to [NAME] for [JOB]"
  const toForRe = new RegExp(
    `\\bto\\s+${NAME_PAT}\\s+for\\s+(?:the\\s+|his\\s+|her\\s+|their\\s+)?(.+)`,
    "i",
  )
  const toForMatch = working.match(toForRe)
  if (toForMatch) {
    customer_name  = toForMatch[1].trim()
    job_title_hint = toForMatch[2].trim().replace(/[,.]$/, "").trim()
  } else {
    // Priority 2: "to [NAME]" — 1+ words, at end of string
    const toRe = new RegExp(
      `\\bto\\s+${NAME_PAT}\\s*[,.]?\\s*$`,
      "i",
    )
    const toMatch = working.match(toRe)
    if (toMatch) {
      customer_name = toMatch[1].trim()
    } else {
      // Priority 3: "contract[s] [NAME]" with no "to" — name directly after "contract"
      const directRe = new RegExp(
        `\\bcontracts?\\s+${NAME_PAT}\\s*[,.]?\\s*$`,
        "i",
      )
      const directMatch = working.match(directRe)
      if (directMatch) {
        customer_name = directMatch[1].trim()
      }
    }
  }

  return { customer_name, job_title_hint, template_name_hint, bundle_all, customer_level }
}
