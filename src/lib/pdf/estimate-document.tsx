import React from "react"
import { Document, Page, Text, View, StyleSheet, Svg, Path, Image, Link } from "@react-pdf/renderer"
import type { EstimateLineItem } from "@/types"
import {
  ESTIMATE_COMPANY, ESTIMATE_TERMS, parseScope, parseNotes, formatMoney, formatLongDate,
} from "@/lib/estimate-format"

// The one estimate design ("Classic Letterhead", chosen Nov 2026) — used for
// the PDF download, the email attachment, Lia's sends and the signed copy.
// Same layout every time; only the content changes.

const BASALT = "#1E2320", BRASS = "#A88532", BRASS_L = "#C9A246", LIME = "#F5F1E7"
const INK = "#22262A", MUTED = "#6B6F73", LINE = "#E4DED0"

export interface EstimatePaymentStep {
  name:         string
  amount:       number
  description?: string | null
}

export interface EstimatePdfProps {
  estimate: {
    number:         string | null       // "E-1048"
    title:          string
    created_at:     string
    valid_until?:   string | null       // YYYY-MM-DD
    scope_of_work:  string | null
    notes?:         string | null
    line_items?:    EstimateLineItem[]
    subtotal?:      number
    markup_percent?: number
    markup_amount?: number
    tax_percent?:   number
    tax_amount?:    number
    total:          number
    payment_steps?: EstimatePaymentStep[]
    approval_link?: string | null
  }
  customer: { name: string; phone?: string | null; email?: string | null; address?: string | null }
  company?: { name?: string | null; phone?: string | null; email?: string | null; license?: string | null }
  signature?: { name: string; png: string; signedAt: string } | null
}

const s = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 54, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 9.4, color: INK, lineHeight: 1.38 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  wordmark: { fontSize: 19, fontFamily: "Times-Bold", letterSpacing: 3.2, color: BASALT, lineHeight: 1.1 },
  sub: { fontSize: 7.2, letterSpacing: 2.6, color: BRASS, marginTop: 2, lineHeight: 1.2 },
  contact: { fontSize: 8, color: MUTED, marginTop: 7, lineHeight: 1.45 },
  docTitle: { fontSize: 22, fontFamily: "Times-Bold", color: BASALT, textAlign: "right", letterSpacing: 1.5, lineHeight: 1.15 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 3 },
  metaK: { fontSize: 7.6, color: MUTED, width: 62, textAlign: "right", marginRight: 6, textTransform: "uppercase", letterSpacing: 0.6 },
  metaV: { fontSize: 8.6, fontFamily: "Helvetica-Bold", width: 92, textAlign: "right" },
  rule: { height: 2, backgroundColor: BRASS_L, marginTop: 16 },
  rule2: { height: 0.6, backgroundColor: BRASS_L, marginTop: 2, marginBottom: 16 },
  boxes: { flexDirection: "row", gap: 12, marginBottom: 20 },
  box: { flex: 1, borderWidth: 0.8, borderColor: LINE, borderRadius: 4, padding: 11 },
  boxK: { fontSize: 7, color: BRASS, letterSpacing: 1.6, marginBottom: 5, fontFamily: "Helvetica-Bold" },
  boxName: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 3, lineHeight: 1.25 },
  total: { fontSize: 17, fontFamily: "Helvetica-Bold", color: BASALT, marginTop: 6, marginBottom: 2, lineHeight: 1.15 },
  h2: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRASS, letterSpacing: 2, marginBottom: 9 },
  sec: { marginBottom: 11 },
  secHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  num: { width: 18, height: 18, borderRadius: 9, backgroundColor: BASALT, color: "#fff", fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 4.4, marginRight: 8 },
  secTitle: { fontSize: 10.6, fontFamily: "Helvetica-Bold", color: BASALT, flex: 1 },
  bullet: { flexDirection: "row", marginLeft: 26, marginBottom: 1.6 },
  dot: { width: 3.4, height: 3.4, backgroundColor: BRASS_L, marginTop: 4.2, marginRight: 7 },
  table: { borderWidth: 0.8, borderColor: LINE, borderRadius: 4 },
  th: { flexDirection: "row", backgroundColor: LIME, paddingVertical: 6, paddingHorizontal: 10 },
  thT: { fontSize: 7.2, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 1 },
  tr: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 10, borderTopWidth: 0.6, borderTopColor: LINE },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 10, borderTopWidth: 0.6, borderTopColor: LINE },
  totalBand: { flexDirection: "row", justifyContent: "space-between", backgroundColor: BASALT, paddingVertical: 10, paddingHorizontal: 12 },
  notes: { backgroundColor: LIME, borderRadius: 4, padding: 11, marginTop: 16 },
  sigs: { flexDirection: "row", gap: 28, marginTop: 26 },
  sigLine: { borderBottomWidth: 0.8, borderBottomColor: INK, height: 34, marginBottom: 4, justifyContent: "flex-end" },
})

// The Omdan three-tower mark (same paths as src/components/brand/omdan-mark.tsx)
const MARK = ["M5 55H59", "M15 55V27L24.5 20V55", "M28.5 55V7L39 16V55", "M39 29L48.5 36.5V55"]
function Mark({ size }: { size: number }) {
  return (
    <Svg viewBox="0 0 64 64" style={{ width: size, height: size }}>
      {MARK.map((d) => <Path key={d} d={d} stroke="#B8913A" strokeWidth={3} fill="none" strokeLinecap="square" />)}
    </Svg>
  )
}

function Bullet({ text, indent = true }: { text: string; indent?: boolean }) {
  return (
    <View style={[s.bullet, indent ? {} : { marginLeft: 0 }]} wrap={false}>
      <View style={s.dot} /><Text style={{ flex: 1 }}>{text}</Text>
    </View>
  )
}

export function EstimatePDFDocument({ estimate: e, customer, company, signature }: EstimatePdfProps) {
  const co = {
    name:    company?.name    || ESTIMATE_COMPANY.name,
    phone:   company?.phone   || ESTIMATE_COMPANY.phone,
    email:   company?.email   || ESTIMATE_COMPANY.email,
    license: company?.license || ESTIMATE_COMPANY.license,
  }
  const scope = parseScope(e.scope_of_work)
  const notes = parseNotes(e.notes)
  const steps = (e.payment_steps ?? []).filter((p) => p.name || p.amount)
  const items = e.line_items ?? []
  const hasExtras = !!((e.markup_amount ?? 0) || (e.tax_amount ?? 0))
  const numberText = e.number ?? ""

  return (
    <Document title={`Estimate ${numberText} — ${e.title}`.trim()} author={co.name}>
      <Page size="LETTER" style={s.page}>
        {/* ── Letterhead ─────────────────────────────────────────────── */}
        <View style={s.head}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Mark size={40} />
              <View style={{ marginLeft: 9 }}>
                <Text style={s.wordmark}>OMDAN</Text>
                <Text style={s.sub}>DEVELOPMENT INC.</Text>
              </View>
            </View>
            <Text style={s.contact}>{co.phone}  ·  {co.email}{"\n"}California Contractor License #{co.license}</Text>
          </View>
          <View>
            <Text style={s.docTitle}>ESTIMATE</Text>
            {numberText ? <View style={[s.metaRow, { marginTop: 8 }]}><Text style={s.metaK}>Estimate #</Text><Text style={s.metaV}>{numberText}</Text></View> : null}
            <View style={[s.metaRow, numberText ? {} : { marginTop: 8 }]}><Text style={s.metaK}>Date</Text><Text style={s.metaV}>{formatLongDate(e.created_at)}</Text></View>
            {e.valid_until ? <View style={s.metaRow}><Text style={s.metaK}>Valid until</Text><Text style={s.metaV}>{formatLongDate(e.valid_until)}</Text></View> : null}
          </View>
        </View>
        <View style={s.rule} /><View style={s.rule2} />

        {/* ── Client + project ───────────────────────────────────────── */}
        <View style={s.boxes}>
          <View style={s.box}>
            <Text style={s.boxK}>PREPARED FOR</Text>
            <Text style={s.boxName}>{customer.name}</Text>
            {customer.phone ? <Text>{customer.phone}</Text> : null}
            {customer.email ? <Text>{customer.email}</Text> : null}
            {customer.address ? <Text>{customer.address}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.boxK}>PROJECT</Text>
            <Text style={s.boxName}>{e.title}</Text>
            {customer.address ? <Text style={{ color: MUTED }}>Site: {customer.address}</Text> : null}
            <Text style={s.total}>{formatMoney(e.total)}</Text>
            <Text style={{ fontSize: 7.6, color: MUTED }}>Total contract price{steps.length ? `  ·  ${steps.length} payment${steps.length === 1 ? "" : "s"}` : ""}</Text>
          </View>
        </View>

        {/* ── Scope of work ──────────────────────────────────────────── */}
        {(scope.intro.length > 0 || scope.sections.length > 0) && <Text style={s.h2}>SCOPE OF WORK</Text>}
        {scope.intro.map((p, k) => <Text key={k} style={{ marginBottom: 6 }}>{p}</Text>)}
        {scope.sections.map((sec, i) => (
          <View key={i} style={s.sec}>
            {/* heading never left alone at the bottom of a page */}
            <View wrap={false}>
              <View style={s.secHead}><Text style={s.num}>{i + 1}</Text><Text style={s.secTitle}>{sec.heading}</Text></View>
              {sec.bullets[0] ? <Bullet text={sec.bullets[0]} /> : null}
            </View>
            {sec.bullets.slice(1).map((b, k) => <Bullet key={k} text={b} />)}
          </View>
        ))}

        {/* ── Line items (only when the estimate has them) ───────────── */}
        {items.length > 0 && (
          <View style={{ marginTop: 8, marginBottom: 8 }}>
            <Text style={s.h2}>LINE ITEMS</Text>
            <View style={s.table}>
              <View style={s.th} fixed>
                <Text style={[s.thT, { flex: 1 }]}>DESCRIPTION</Text>
                <Text style={[s.thT, { width: 40, textAlign: "right" }]}>QTY</Text>
                <Text style={[s.thT, { width: 70, textAlign: "right" }]}>UNIT</Text>
                <Text style={[s.thT, { width: 80, textAlign: "right" }]}>AMOUNT</Text>
              </View>
              {items.map((it, i) => (
                <View key={i} style={s.tr} wrap={false}>
                  <Text style={{ flex: 1, paddingRight: 8 }}>{it.description}</Text>
                  <Text style={{ width: 40, textAlign: "right" }}>{it.quantity}</Text>
                  <Text style={{ width: 70, textAlign: "right" }}>{formatMoney(it.unit_price)}</Text>
                  <Text style={{ width: 80, textAlign: "right", fontFamily: "Helvetica-Bold" }}>{formatMoney(it.quantity * it.unit_price)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Payment schedule + total (never split across pages) ────── */}
        <View wrap={false} style={{ marginTop: 8 }}>
          <Text style={s.h2}>{steps.length ? "PAYMENT SCHEDULE" : "TOTAL"}</Text>
          <View style={s.table}>
            {steps.length > 0 && (
              <View style={s.th}>
                <Text style={[s.thT, { width: 22 }]}>#</Text>
                <Text style={[s.thT, { flex: 1 }]}>MILESTONE</Text>
                <Text style={[s.thT, { width: 80, textAlign: "right" }]}>AMOUNT</Text>
              </View>
            )}
            {steps.map((p, i) => (
              <View key={i} style={s.tr}>
                <Text style={{ width: 22, color: MUTED, fontFamily: "Helvetica-Bold" }}>{i + 1}</Text>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.name}</Text>
                  {p.description ? <Text style={{ fontSize: 8, color: MUTED }}>{p.description}</Text> : null}
                </View>
                <Text style={{ width: 80, textAlign: "right", fontFamily: "Helvetica-Bold" }}>{formatMoney(p.amount)}</Text>
              </View>
            ))}
            {hasExtras && (
              <>
                <View style={s.sumRow}><Text style={{ color: MUTED }}>Subtotal</Text><Text>{formatMoney(e.subtotal ?? 0)}</Text></View>
                {(e.markup_amount ?? 0) > 0 && <View style={s.sumRow}><Text style={{ color: MUTED }}>Markup ({e.markup_percent}%)</Text><Text>{formatMoney(e.markup_amount ?? 0)}</Text></View>}
                {(e.tax_amount ?? 0) > 0 && <View style={s.sumRow}><Text style={{ color: MUTED }}>Tax ({e.tax_percent}%)</Text><Text>{formatMoney(e.tax_amount ?? 0)}</Text></View>}
              </>
            )}
            <View style={s.totalBand}>
              <Text style={{ color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 1.2 }}>TOTAL CONTRACT PRICE</Text>
              <Text style={{ color: BRASS_L, fontFamily: "Helvetica-Bold", fontSize: 13 }}>{formatMoney(e.total)}</Text>
            </View>
          </View>
        </View>

        {/* ── Project notes ──────────────────────────────────────────── */}
        {notes.length > 0 && (
          <View style={s.notes} wrap={false}>
            <Text style={s.h2}>PROJECT NOTES</Text>
            {notes.map((t, k) => <Bullet key={k} text={t} indent={false} />)}
          </View>
        )}

        {/* ── Terms + signatures ─────────────────────────────────────── */}
        <View wrap={false} style={{ marginTop: 16 }}>
          <Text style={s.h2}>TERMS</Text>
          {ESTIMATE_TERMS.map((t, k) => <Text key={k} style={{ fontSize: 8.2, color: MUTED, marginBottom: 2 }}>{k + 1}. {t}</Text>)}
          {e.approval_link && !signature ? (
            <Text style={{ fontSize: 8.2, marginTop: 6 }}>
              Review and sign online: <Link src={e.approval_link} style={{ color: BRASS }}>{e.approval_link}</Link>
            </Text>
          ) : null}
          <View style={s.sigs}>
            <View style={{ flex: 1 }}>
              <View style={s.sigLine}>
                {signature ? <Image src={signature.png} style={{ height: 30, width: 150, objectFit: "contain" }} /> : null}
              </View>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 8.6 }}>Client signature</Text>
              {signature ? (
                <Text style={{ fontSize: 8, color: MUTED }}>Signed electronically by {signature.name} on {formatLongDate(signature.signedAt)}</Text>
              ) : (
                <Text style={{ fontSize: 8, color: MUTED }}>{customer.name}  ·  Date ____________</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.sigLine} />
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 8.6 }}>{co.name}</Text>
              <Text style={{ fontSize: 8, color: MUTED }}>Authorized representative  ·  Date ____________</Text>
            </View>
          </View>
        </View>

        {/* ── Footer on every page ───────────────────────────────────── */}
        <View fixed style={{ position: "absolute", top: 752, left: 44, right: 44, height: 0.6, backgroundColor: LINE }} />
        <Text fixed style={{ position: "absolute", top: 760, left: 44, fontSize: 7.2, color: MUTED }}>
          {co.name}  ·  Lic #{co.license}  ·  {co.phone}
        </Text>
        <Text fixed style={{ position: "absolute", top: 760, right: 44, fontSize: 7.2, color: MUTED, fontFamily: "Helvetica" }}
          render={({ pageNumber, totalPages }) => `${numberText ? `Estimate ${numberText}  ·  ` : ""}Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  )
}
