import React from "react"
import {
  Document, Page, Text, View, StyleSheet, Image, Link,
} from "@react-pdf/renderer"
import type { EstimateLineItem } from "@/types"

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  dark:   "#1f5b48",
  accent: "#be9d4b",
  muted:  "#64748b",
  light:  "#f8fafc",
  border: "#e2e8f0",
  white:  "#ffffff",
}

const styles = StyleSheet.create({
  page: {
    fontFamily:      "Helvetica",
    fontSize:        9,
    color:           C.dark,
    paddingTop:      48,
    paddingBottom:   72,
    paddingHorizontal: 48,
    lineHeight:      1.4,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     "row",
    justifyContent:    "space-between",
    alignItems:        "flex-start",
    marginBottom:      24,
  },
  logo: {
    width:      64,
    height:     64,
    objectFit:  "contain",
  },
  logoPlaceholder: {
    width:           64,
    height:          64,
    backgroundColor: C.dark,
    borderRadius:    4,
    alignItems:      "center",
    justifyContent:  "center",
  },
  logoPlaceholderText: {
    color:       C.white,
    fontSize:    18,
    fontFamily:  "Helvetica-Bold",
  },
  companyBlock: {
    alignItems: "flex-end",
    maxWidth:   220,
  },
  companyName: {
    fontSize:    14,
    fontFamily:  "Helvetica-Bold",
    color:       C.dark,
    marginBottom: 3,
    textAlign:   "right",
  },
  companyDetail: {
    fontSize:  8,
    color:     C.muted,
    textAlign: "right",
    marginBottom: 2,
  },

  // ── Title band ───────────────────────────────────────────────────────────────
  titleBand: {
    backgroundColor:  C.dark,
    paddingVertical:  10,
    paddingHorizontal: 14,
    flexDirection:    "row",
    justifyContent:   "space-between",
    alignItems:       "center",
    marginBottom:     24,
  },
  titleText: {
    color:       C.white,
    fontSize:    15,
    fontFamily:  "Helvetica-Bold",
    letterSpacing: 3,
  },
  titleMeta: {
    alignItems: "flex-end",
  },
  titleMetaLabel: {
    color:     "#e8d5a3",
    fontSize:  7,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  titleMetaValue: {
    color:     C.white,
    fontSize:  8,
    fontFamily: "Helvetica-Bold",
  },

  // ── Two-column info row ───────────────────────────────────────────────────────
  infoRow: {
    flexDirection:  "row",
    marginBottom:   24,
    gap:            24,
  },
  infoBlock: {
    flex: 1,
  },
  infoLabel: {
    fontSize:      7,
    fontFamily:    "Helvetica-Bold",
    color:         C.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
    paddingBottom: 3,
    marginBottom:  6,
  },
  infoName: {
    fontSize:  10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  infoDetail: {
    fontSize:  8,
    color:     C.muted,
    marginBottom: 2,
  },

  // ── Section ──────────────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize:      7,
    fontFamily:    "Helvetica-Bold",
    color:         C.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingBottom: 4,
    marginBottom:  8,
  },
  scopeText: {
    fontSize:    8.5,
    color:       C.dark,
    lineHeight:  1.6,
    marginBottom: 20,
  },

  // ── Table ────────────────────────────────────────────────────────────────────
  tableContainer: {
    marginBottom: 0,
  },
  tableHead: {
    flexDirection:    "row",
    backgroundColor:  C.dark,
    paddingVertical:  6,
    paddingHorizontal: 10,
  },
  tableRow: {
    flexDirection:    "row",
    paddingVertical:  6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableRowEven: {
    backgroundColor: C.light,
  },
  thText: {
    color:         C.white,
    fontSize:      7,
    fontFamily:    "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tdText: {
    fontSize: 8.5,
    color:    C.dark,
  },
  tdMuted: {
    fontSize: 7,
    color:    C.muted,
    marginLeft: 4,
  },
  colDesc:  { flex: 4, flexDirection: "row", alignItems: "center" },
  colQty:   { flex: 0.8, textAlign: "right" },
  colPrice: { flex: 1.5, textAlign: "right" },
  colTotal: { flex: 1.5, textAlign: "right" },

  // ── Totals ───────────────────────────────────────────────────────────────────
  totalsSection: {
    alignItems:  "flex-end",
    marginTop:   12,
    marginBottom: 24,
  },
  totalRow: {
    flexDirection:   "row",
    justifyContent:  "flex-end",
    marginBottom:    4,
    minWidth:        220,
  },
  totalLabel: {
    fontSize:  8.5,
    color:     C.muted,
    width:     100,
    textAlign: "right",
    paddingRight: 16,
  },
  totalValue: {
    fontSize:  8.5,
    width:     90,
    textAlign: "right",
  },
  grandTotalBand: {
    flexDirection:    "row",
    backgroundColor:  C.accent,
    paddingVertical:  10,
    paddingHorizontal: 16,
    minWidth:         220,
    marginTop:        6,
  },
  grandTotalLabel: {
    color:      C.white,
    fontSize:   10,
    fontFamily: "Helvetica-Bold",
    flex:       1,
    textAlign:  "right",
    paddingRight: 16,
  },
  grandTotalValue: {
    color:      C.white,
    fontSize:   12,
    fontFamily: "Helvetica-Bold",
    width:      90,
    textAlign:  "right",
  },

  // ── Notes ────────────────────────────────────────────────────────────────────
  notesBox: {
    backgroundColor: C.light,
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
    paddingVertical:  10,
    paddingHorizontal: 12,
    marginBottom:     24,
  },
  notesLabel: {
    fontSize:      7,
    fontFamily:    "Helvetica-Bold",
    color:         C.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom:  5,
  },
  notesText: {
    fontSize:   8.5,
    color:      C.dark,
    lineHeight: 1.6,
  },

  // ── Footer ───────────────────────────────────────────────────────────────────
  footer: {
    position:   "absolute",
    bottom:     32,
    left:       48,
    right:      48,
    flexDirection:  "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop:  8,
  },
  footerText: {
    fontSize: 7,
    color:    C.muted,
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style:    "currency",
    currency: "USD",
  }).format(n)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EstimatePaymentStep {
  name: string
  amount: number
  sort_order?: number
}

export interface EstimatePDFData {
  estimate: {
    id: string
    title: string
    created_at: string
    scope_of_work: string | null
    line_items: EstimateLineItem[]
    subtotal: number
    markup_percent: number
    markup_amount: number
    tax_percent: number
    tax_amount: number
    total: number
    notes: string | null
    payment_steps?: EstimatePaymentStep[]
    approval_link?: string | null
  }
  customer: {
    name: string
    address: string | null
    phone: string | null
    email: string | null
  }
  company: {
    company_name: string | null
    phone: string | null
    email: string | null
    license_number: string | null
    logo_url: string | null
    address: string | null
  }
}

// ── Document ──────────────────────────────────────────────────────────────────

export function EstimatePDFDocument({ estimate, customer, company }: EstimatePDFData) {
  const lineItems: EstimateLineItem[] = estimate.line_items ?? []
  const date = new Date(estimate.created_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  })
  const initials = (company.company_name ?? "O")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const hasMixedTaxability = estimate.tax_percent > 0 &&
    lineItems.some(i => i.taxable === false) &&
    lineItems.some(i => i.taxable !== false)

  return (
    <Document title={estimate.title} author={company.company_name ?? ""}>
      <Page size="LETTER" style={styles.page}>

        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Logo or initials placeholder */}
          {company.logo_url ? (
            <Image src={company.logo_url} style={styles.logo} />
          ) : (
            <View style={styles.logoPlaceholder}>
              <Text style={styles.logoPlaceholderText}>{initials}</Text>
            </View>
          )}

          {/* Company info */}
          <View style={styles.companyBlock}>
            {company.company_name && (
              <Text style={styles.companyName}>{company.company_name}</Text>
            )}
            {company.phone && <Text style={styles.companyDetail}>{company.phone}</Text>}
            {company.email && <Text style={styles.companyDetail}>{company.email}</Text>}
            {company.address && <Text style={styles.companyDetail}>{company.address}</Text>}
            {company.license_number && (
              <Text style={styles.companyDetail}>Lic# {company.license_number}</Text>
            )}
          </View>
        </View>

        {/* ── Title band ─────────────────────────────────────────── */}
        <View style={styles.titleBand}>
          <Text style={styles.titleText}>ESTIMATE</Text>
          <View style={styles.titleMeta}>
            <Text style={styles.titleMetaLabel}>Date</Text>
            <Text style={styles.titleMetaValue}>{date}</Text>
          </View>
        </View>

        {/* ── Estimate title + Bill To ────────────────────────────── */}
        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Bill To</Text>
            <Text style={styles.infoName}>{customer.name}</Text>
            {customer.address && <Text style={styles.infoDetail}>{customer.address}</Text>}
            {customer.phone && <Text style={styles.infoDetail}>{customer.phone}</Text>}
            {customer.email && <Text style={styles.infoDetail}>{customer.email}</Text>}
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Estimate For</Text>
            <Text style={styles.infoName}>{estimate.title}</Text>
          </View>
        </View>

        {/* ── Scope of work ──────────────────────────────────────── */}
        {estimate.scope_of_work && (
          <View>
            <Text style={styles.sectionLabel}>Scope of Work</Text>
            <Text style={styles.scopeText}>{estimate.scope_of_work}</Text>
          </View>
        )}

        {/* ── Line items table ───────────────────────────────────── */}
        <View style={styles.tableContainer}>
          {/* Header row */}
          <View style={styles.tableHead}>
            <Text style={[styles.thText, { flex: 4 }]}>Description</Text>
            <Text style={[styles.thText, styles.colQty, { textAlign: "right" }]}>Qty</Text>
            <Text style={[styles.thText, styles.colPrice, { textAlign: "right" }]}>Unit Price</Text>
            <Text style={[styles.thText, styles.colTotal, { textAlign: "right" }]}>Amount</Text>
          </View>

          {/* Data rows */}
          {lineItems.map((item, i) => {
            const isNonTaxable = item.taxable === false
            return (
              <View key={item.id} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowEven : {}]}>
                <View style={styles.colDesc}>
                  <Text style={styles.tdText}>{item.description}</Text>
                  {isNonTaxable && estimate.tax_percent > 0 && (
                    <Text style={styles.tdMuted}>(NT)</Text>
                  )}
                </View>
                <Text style={[styles.tdText, styles.colQty, { textAlign: "right" }]}>{item.quantity}</Text>
                <Text style={[styles.tdText, styles.colPrice, { textAlign: "right" }]}>{fmt(item.unit_price)}</Text>
                <Text style={[styles.tdText, styles.colTotal, { textAlign: "right" }]}>{fmt(item.quantity * item.unit_price)}</Text>
              </View>
            )
          })}
        </View>

        {/* ── Totals ─────────────────────────────────────────────── */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{fmt(Number(estimate.subtotal))}</Text>
          </View>

          {Number(estimate.markup_percent) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Markup ({estimate.markup_percent}%)</Text>
              <Text style={styles.totalValue}>{fmt(Number(estimate.markup_amount))}</Text>
            </View>
          )}

          {Number(estimate.tax_percent) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                Tax ({estimate.tax_percent}%){hasMixedTaxability ? " *" : ""}
              </Text>
              <Text style={styles.totalValue}>{fmt(Number(estimate.tax_amount))}</Text>
            </View>
          )}

          {hasMixedTaxability && (
            <View style={[styles.totalRow, { marginTop: 2 }]}>
              <Text style={[styles.totalLabel, { fontSize: 7, color: C.muted, width: 200 }]}>
                * Tax applies to taxable items only. NT = non-taxable.
              </Text>
            </View>
          )}

          <View style={styles.grandTotalBand}>
            <Text style={styles.grandTotalLabel}>TOTAL</Text>
            <Text style={styles.grandTotalValue}>{fmt(Number(estimate.total))}</Text>
          </View>
        </View>

        {/* ── Payment Schedule ───────────────────────────────────── */}
        {(estimate.payment_steps?.length ?? 0) > 0 && (
          <View style={{ marginBottom: 24 }}>
            <Text style={styles.sectionLabel}>Payment Schedule</Text>
            {[...(estimate.payment_steps ?? [])]
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map((step, i) => (
                <View
                  key={i}
                  style={[
                    styles.tableRow,
                    i % 2 === 1 ? styles.tableRowEven : {},
                  ]}
                >
                  <Text style={[styles.tdText, { flex: 4 }]}>{step.name}</Text>
                  <Text style={[styles.tdText, { flex: 2, textAlign: "right" }]}>
                    {fmt(step.amount)}
                  </Text>
                </View>
              ))}
          </View>
        )}

        {/* ── Notes ──────────────────────────────────────────────── */}
        {estimate.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{estimate.notes}</Text>
          </View>
        )}

        {/* ── Approval link ───────────────────────────────────────── */}
        {estimate.approval_link && (
          <View style={[styles.notesBox, { borderLeftColor: C.dark, marginBottom: 24 }]}>
            <Text style={[styles.notesLabel, { color: C.dark }]}>Approve This Estimate</Text>
            <Text style={[styles.notesText, { marginBottom: 4 }]}>
              Review and approve your estimate online:
            </Text>
            <Link src={estimate.approval_link} style={{ fontSize: 8, color: C.dark }}>
              {estimate.approval_link}
            </Link>
          </View>
        )}

        {/* ── Footer ─────────────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {company.company_name ?? ""}{company.license_number ? ` · Lic# ${company.license_number}` : ""}
          </Text>
          <Text style={styles.footerText}>Thank you for your business!</Text>
        </View>

      </Page>
    </Document>
  )
}
