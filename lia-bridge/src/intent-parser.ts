// ─── Intent types ─────────────────────────────────────────────────────────────

export type Intent =
  | { type: "health_check" }
  | { type: "daily_attention" }
  | { type: "approval_reply"; approvalId: string; action: "approve" | "reject" }
  | { type: "unknown"; rawText: string }

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parseIntent(text: string): Intent {
  const trimmed = text.trim()
  const lower   = trimmed.toLowerCase()

  // Interactive button reply IDs sent by OpenClaw: "approve_<uuid>" / "reject_<uuid>"
  const btnApprove = lower.match(/^approve_([0-9a-f-]{36})$/)
  if (btnApprove) return { type: "approval_reply", approvalId: btnApprove[1], action: "approve" }

  const btnReject = lower.match(/^reject_([0-9a-f-]{36})$/)
  if (btnReject) return { type: "approval_reply", approvalId: btnReject[1], action: "reject" }

  // Typed approval reply: "APPROVE <uuid>" / "REJECT <uuid>"
  const typedApprove = lower.match(/^approve\s+([0-9a-f-]{36})/)
  if (typedApprove) return { type: "approval_reply", approvalId: typedApprove[1], action: "approve" }

  const typedReject = lower.match(/^reject\s+([0-9a-f-]{36})/)
  if (typedReject) return { type: "approval_reply", approvalId: typedReject[1], action: "reject" }

  // Short approval IDs (first 8 chars): "APPROVE 3f2a1b4c" (for convenience)
  const shortApprove = lower.match(/^approve\s+([0-9a-f]{8})$/)
  if (shortApprove) return { type: "approval_reply", approvalId: shortApprove[1], action: "approve" }

  const shortReject = lower.match(/^reject\s+([0-9a-f]{8})$/)
  if (shortReject) return { type: "approval_reply", approvalId: shortReject[1], action: "reject" }

  // Health / connectivity check
  if (/connected|health|alive|online|test/.test(lower)) return { type: "health_check" }
  if (/are you|lia.*connect/.test(lower))               return { type: "health_check" }

  // Daily attention / summary
  if (/attention|today|summary|overview|pending|what.*need|review|status/.test(lower)) {
    return { type: "daily_attention" }
  }

  return { type: "unknown", rawText: trimmed }
}
