import type {
  CrmHealthResponse, CrmMessageResponse, AssistantApproval, ExecuteResponse,
  LeadData, EstimateData, InvoiceData,
} from "./types"

const BASE_URL = process.env.CRM_BASE_URL!
const SECRET   = process.env.CRM_ASSISTANT_SECRET!

async function crmFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-assistant-secret": SECRET,
      ...(options.headers as Record<string, string> ?? {}),
    },
  })
  return res
}

export async function checkHealth(): Promise<CrmHealthResponse> {
  const res = await crmFetch("/api/assistant/health")
  if (!res.ok) throw new Error(`CRM health check failed: ${res.status}`)
  return res.json() as Promise<CrmHealthResponse>
}

export interface SendMessageBody {
  message: string
  sender?: string
  intent?: string
  lead?: LeadData
  estimate?: EstimateData | null
  wants_estimate?: boolean
  invoice_data?: InvoiceData
}

export async function sendMessage(body: SendMessageBody): Promise<CrmMessageResponse> {
  const res = await crmFetch("/api/assistant/message", {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CRM message failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<CrmMessageResponse>
}

export async function getPendingApprovals(): Promise<AssistantApproval[]> {
  const res = await crmFetch("/api/assistant/approvals")
  if (!res.ok) throw new Error(`CRM approvals fetch failed: ${res.status}`)
  const data = await res.json() as { approvals: AssistantApproval[] }
  return data.approvals
}

export async function getApproval(id: string): Promise<AssistantApproval> {
  const res = await crmFetch(`/api/assistant/approvals/${id}`)
  if (!res.ok) throw new Error(`CRM approval fetch failed: ${res.status}`)
  const data = await res.json() as { approval: AssistantApproval }
  return data.approval
}

export async function updateApproval(
  id: string,
  status: "approved" | "rejected" | "edited" | "executed" | "failed",
  extras?: { result?: unknown; error?: string; proposed_payload?: unknown }
): Promise<AssistantApproval> {
  const res = await crmFetch(`/api/assistant/approvals/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...extras }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CRM approval update failed (${res.status}): ${text}`)
  }
  const data = await res.json() as { approval: AssistantApproval }
  return data.approval
}

export async function executeApproval(id: string): Promise<ExecuteResponse> {
  const res = await crmFetch(`/api/assistant/execute/${id}`, { method: "POST" })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CRM execute failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<ExecuteResponse>
}
