// ─── Intent types ─────────────────────────────────────────────────────────────

export type Intent =
  | { type: "health_check" }
  | { type: "daily_attention" }
  | { type: "approval_reply"; approvalId: string; action: "approve" | "reject" }
  | { type: "edit_approval"; approvalId: string }
  | { type: "add_lead_estimate"; rawText: string }
  | { type: "create_invoice"; rawText: string }
  | { type: "schedule_job"; rawText: string }
  | { type: "send_contract"; rawText: string }
  | { type: "pick_customer"; index: number }
  | { type: "pick_job"; index: number }
  | { type: "pick_schedule_customer"; index: number }
  | { type: "pick_schedule_job"; index: number }
  | { type: "pick_contract_customer"; index: number }
  | { type: "pick_contract_job"; index: number }
  | { type: "pick_contract_template"; index: number }
  | { type: "pick_all_contracts" }
  | { type: "cancel_invoice" }
  | { type: "cancel_schedule" }
  | { type: "cancel_contract" }
  | { type: "unknown"; rawText: string }

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parseIntent(text: string): Intent {
  const trimmed = text.trim()
  const lower   = trimmed.toLowerCase()

  // Telegram inline button callbacks: "approve:<uuid>", "reject:<uuid>", "edit:<uuid>"
  const tgApprove = lower.match(/^approve:([0-9a-f-]{36})$/)
  if (tgApprove) return { type: "approval_reply", approvalId: tgApprove[1], action: "approve" }

  const tgReject = lower.match(/^reject:([0-9a-f-]{36})$/)
  if (tgReject) return { type: "approval_reply", approvalId: tgReject[1], action: "reject" }

  const tgEdit = lower.match(/^edit:([0-9a-f-]{36})$/)
  if (tgEdit) return { type: "edit_approval", approvalId: tgEdit[1] }

  // Customer disambiguation button callback: "pick_customer:N"
  const pickCustomer = lower.match(/^pick_customer:(\d+)$/)
  if (pickCustomer) return { type: "pick_customer", index: parseInt(pickCustomer[1], 10) }

  // Job disambiguation button callback: "pick_job:N"
  const pickJob = lower.match(/^pick_job:(\d+)$/)
  if (pickJob) return { type: "pick_job", index: parseInt(pickJob[1], 10) }

  // Schedule disambiguation callbacks
  const pickSchedCustomer = lower.match(/^pick_schedule_customer:(\d+)$/)
  if (pickSchedCustomer) return { type: "pick_schedule_customer", index: parseInt(pickSchedCustomer[1], 10) }

  const pickSchedJob = lower.match(/^pick_schedule_job:(\d+)$/)
  if (pickSchedJob) return { type: "pick_schedule_job", index: parseInt(pickSchedJob[1], 10) }

  // Contract disambiguation callbacks
  const pickContractCustomer = lower.match(/^pick_contract_customer:(\d+)$/)
  if (pickContractCustomer) return { type: "pick_contract_customer", index: parseInt(pickContractCustomer[1], 10) }

  const pickContractJob = lower.match(/^pick_contract_job:(\d+)$/)
  if (pickContractJob) return { type: "pick_contract_job", index: parseInt(pickContractJob[1], 10) }

  const pickContractTemplate = lower.match(/^pick_contract_template:(\d+)$/)
  if (pickContractTemplate) return { type: "pick_contract_template", index: parseInt(pickContractTemplate[1], 10) }

  if (lower === "pick_all_contracts") return { type: "pick_all_contracts" }

  // Cancel callbacks
  if (lower === "cancel_invoice") return { type: "cancel_invoice" }
  if (lower === "cancel_schedule") return { type: "cancel_schedule" }
  if (lower === "cancel_contract") return { type: "cancel_contract" }

  // OpenClaw interactive button format: "approve_<uuid>" / "reject_<uuid>"
  const btnApprove = lower.match(/^approve_([0-9a-f-]{36})$/)
  if (btnApprove) return { type: "approval_reply", approvalId: btnApprove[1], action: "approve" }

  const btnReject = lower.match(/^reject_([0-9a-f-]{36})$/)
  if (btnReject) return { type: "approval_reply", approvalId: btnReject[1], action: "reject" }

  // Typed approval commands: "APPROVE <uuid>" / "REJECT <uuid>" / "EDIT <uuid>"
  const typedApprove = lower.match(/^approve\s+([0-9a-f-]{36})/)
  if (typedApprove) return { type: "approval_reply", approvalId: typedApprove[1], action: "approve" }

  const typedReject = lower.match(/^reject\s+([0-9a-f-]{36})/)
  if (typedReject) return { type: "approval_reply", approvalId: typedReject[1], action: "reject" }

  const typedEdit = lower.match(/^edit\s+([0-9a-f-]{36})/)
  if (typedEdit) return { type: "edit_approval", approvalId: typedEdit[1] }

  // Short IDs (first 8 chars) for convenience
  const shortApprove = lower.match(/^approve\s+([0-9a-f]{8})$/)
  if (shortApprove) return { type: "approval_reply", approvalId: shortApprove[1], action: "approve" }

  const shortReject = lower.match(/^reject\s+([0-9a-f]{8})$/)
  if (shortReject) return { type: "approval_reply", approvalId: shortReject[1], action: "reject" }

  // Invoice request — must come before lead detection to avoid "invoice" triggering "add lead"
  if (/\b(?:invoice|bill)\b/.test(lower) && /\b(?:invoice|bill|send|create)\b/.test(lower)) {
    // Exclude messages that are clearly about viewing/checking invoices rather than creating
    if (!/\b(?:check|view|show|list|status|paid|unpaid)\b/.test(lower)) {
      return { type: "create_invoice", rawText: trimmed }
    }
  }
  // Natural phrasing without keyword overlap
  if (/\bsend\s+(?:an?\s+)?invoice\b|\bcreate\s+(?:an?\s+)?invoice\b/.test(lower)) {
    return { type: "create_invoice", rawText: trimmed }
  }

  // Contract send request
  if (/\bsend\b/.test(lower) && /\bcontracts?\b/.test(lower)) {
    if (!/\b(?:check|view|show|list|status|signed|unsigned)\b/.test(lower)) {
      return { type: "send_contract", rawText: trimmed }
    }
  }

  // Schedule job — explicit scheduling requests
  if (/\b(?:schedule|book)\b/.test(lower) && /\b(?:job|on\s+the\s+calendar|calendar)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|morning|afternoon|\d{1,2}am|\d{1,2}pm)\b/.test(lower)) {
    if (!/\b(?:check|view|show|list|status)\b/.test(lower)) {
      return { type: "schedule_job", rawText: trimmed }
    }
  }
  if (/\bput\b.+\bon\s+the\s+calendar\b/.test(lower)) {
    return { type: "schedule_job", rawText: trimmed }
  }

  // Add lead / new lead
  if (/add\s+(this\s+)?lead|new\s+lead|lia\s+add/.test(lower)) {
    return { type: "add_lead_estimate", rawText: trimmed }
  }
  // Implicit lead: has "name" plus lead-like fields
  if (/\bname\s*[-:]\s*\S/.test(lower) && /\b(phone|needs?|charge|estimate)\b/.test(lower)) {
    return { type: "add_lead_estimate", rawText: trimmed }
  }

  // Health / connectivity check
  if (/connected|health|alive|online|test/.test(lower)) return { type: "health_check" }
  if (/are you|lia.*connect/.test(lower))               return { type: "health_check" }

  // Daily attention / summary
  if (/attention|today|summary|overview|pending|what.*need|review|status/.test(lower)) {
    return { type: "daily_attention" }
  }

  return { type: "unknown", rawText: trimmed }
}
