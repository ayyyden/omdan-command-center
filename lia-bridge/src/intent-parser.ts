// ─── Intent types ─────────────────────────────────────────────────────────────

export type Intent =
  | { type: "health_check" }
  | { type: "daily_attention" }
  | { type: "approval_reply"; approvalId: string; action: "approve" | "reject" }
  | { type: "edit_approval"; approvalId: string }
  | { type: "add_lead_estimate"; rawText: string }
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
