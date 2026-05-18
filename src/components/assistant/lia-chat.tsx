"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button }    from "@/components/ui/button"
import { Textarea }  from "@/components/ui/textarea"
import { Send, Plus, Loader2, Bot, User } from "lucide-react"
import { ApprovalCard } from "./approval-card"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionDraft {
  type:       string
  summary:    string
  payload:    Record<string, unknown>
  risk_level: "low" | "medium" | "high"
}

interface Message {
  id:         string
  role:       "user" | "assistant"
  content:    string
  action_id:  string | null
  action:     ActionDraft | null
  created_at: string
  approval?:  { status: string; result: Record<string, unknown> | null } | null
}

interface Props {
  conversationId: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LiaChat({ conversationId }: Props) {
  const router   = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState("")
  const [sending,   setSending]   = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [errMsg,    setErrMsg]    = useState<string | null>(null)

  // Load conversation messages
  const loadMessages = useCallback(async () => {
    try {
      const res  = await fetch(`/api/assistant/conversations/${conversationId}`)
      if (!res.ok) return
      const data = await res.json()
      const msgs = (data.messages ?? []) as Array<{
        id: string; role: string; content: string
        action_id: string | null; metadata: { action?: ActionDraft } | null
        created_at: string
        approval?: { status: string; result: unknown } | null
      }>
      setMessages(
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id:         m.id,
            role:       m.role as "user" | "assistant",
            content:    m.content,
            action_id:  m.action_id,
            action:     m.metadata?.action ?? null,
            created_at: m.created_at,
            approval:   m.approval as Message["approval"],
          })),
      )
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setInput("")
    setErrMsg(null)
    setSending(true)

    // Optimistically add user message
    const tempId = `temp-${Date.now()}`
    const userMsg: Message = {
      id: tempId, role: "user", content: text,
      action_id: null, action: null, created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    try {
      const res  = await fetch(`/api/assistant/conversations/${conversationId}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrMsg(data.error ?? "Failed to send message")
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
      } else {
        const assistantMsg: Message = {
          id:         data.id ?? `a-${Date.now()}`,
          role:       "assistant",
          content:    data.content,
          action_id:  data.action_id,
          action:     data.action ?? null,
          created_at: data.created_at,
          approval:   null,
        }
        setMessages((prev) => [...prev, assistantMsg])
      }
    } catch {
      setErrMsg("Network error — please try again")
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleNewConversation() {
    const res  = await fetch("/api/assistant/conversations", { method: "POST" })
    const data = await res.json()
    if (data.id) router.push(`/lia?conv=${data.id}`)
  }

  const handleEditSubmit = useCallback(async (correction: string) => {
    setSending(true)
    setErrMsg(null)
    const tempId = `temp-edit-${Date.now()}`
    const userMsg: Message = {
      id: tempId, role: "user", content: correction,
      action_id: null, action: null, created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    try {
      const res  = await fetch(`/api/assistant/conversations/${conversationId}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: correction }),
      })
      const data = await res.json()
      if (res.ok) {
        const assistantMsg: Message = {
          id:         data.id ?? `a-${Date.now()}`,
          role:       "assistant",
          content:    data.content,
          action_id:  data.action_id,
          action:     data.action ?? null,
          created_at: data.created_at,
          approval:   null,
        }
        setMessages((prev) => [...prev, assistantMsg])
      } else {
        setErrMsg(data.error ?? "Failed to send correction")
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
      }
    } catch {
      setErrMsg("Network error — please try again")
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setSending(false)
    }
  }, [conversationId])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-muted-foreground" />
          <span className="font-semibold text-sm">Lia</span>
          <span className="text-xs text-muted-foreground hidden sm:block">— approval-first CRM assistant</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleNewConversation}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          New chat
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Bot className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground max-w-xs">
              Hi! I&apos;m Lia. Ask me to create invoices, draft estimates, schedule jobs, or update notes.
              I&apos;ll show you a preview before anything happens.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            conversationId={conversationId}
            onEditSubmit={handleEditSubmit}
          />
        ))}

        {sending && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-muted text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}

        {errMsg && (
          <p className="text-xs text-destructive text-center">{errMsg}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={inputRef}
            rows={1}
            placeholder="Ask Lia to create an invoice, draft an estimate, schedule a job…"
            className="resize-none min-h-[38px] max-h-32 text-sm leading-relaxed py-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <Button
            size="icon"
            className="h-[38px] w-[38px] shrink-0"
            disabled={!input.trim() || sending}
            onClick={handleSend}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  conversationId,
  onEditSubmit,
}: {
  msg:            Message
  conversationId: string
  onEditSubmit:   (correction: string) => void
}) {
  const isUser = msg.role === "user"

  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        isUser ? "bg-primary text-primary-foreground" : "bg-muted"
      }`}>
        {isUser
          ? <User className="w-4 h-4" />
          : <Bot className="w-4 h-4 text-muted-foreground" />
        }
      </div>

      {/* Content */}
      <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        }`}>
          {msg.content}
        </div>

        {/* Approval card — shown below assistant bubbles that have a pending action */}
        {!isUser && msg.action && msg.action_id && (
          <ApprovalCard
            actionId={msg.action_id}
            conversationId={conversationId}
            action={msg.action}
            initialStatus={msg.approval?.status ?? "pending"}
            initialResult={msg.approval?.result ?? null}
            onEditSubmit={onEditSubmit}
          />
        )}
      </div>
    </div>
  )
}
