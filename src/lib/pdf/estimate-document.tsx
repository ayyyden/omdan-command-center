import React from "react"
import {
  Document, Page, Text, View, StyleSheet, Image, Link,
} from "@react-pdf/renderer"
import type { EstimateLineItem } from "@/types"

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  dark:   "#1f5b48",
  accent: "#be9d4b",
  muted:  "#8898aa",
  light:  "#f7f7f4",
  border: "#e2e8f0",
  white:  "#ffffff",
  text:   "#111111",
}

const styles = StyleSheet.create({
  page: {
    fontFamily:        "Helvetica",
    fontSize:          9,
    color:             C.text,
    paddingTop:        36,
    paddingBottom:     56,
    paddingHorizontal: 40,
    lineHeight:        1.4,
    backgroundColor:   C.white,
  },

  // ── Header ───────────────────────────────────────────────────────────────────
  header: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "flex-start",
    marginBottom:   14,
  },
  estimateTitle: {
    fontSize:      28,
    fontFamily:    "Helvetica-Bold",
    color:         C.dark,
    letterSpacing: 2,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  logo: {
    width:        60,
    height:       60,
    objectFit:    "contain",
    marginBottom: 5,
  },
  logoPlaceholder: {
    width:           60,
    height:          60,
    backgroundColor: C.dark,
    borderRadius:    4,
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    5,
  },
  logoPlaceholderText: {
    color:      C.white,
    fontSize:   18,
    fontFamily: "Helvetica-Bold",
  },
  companyName: {
    fontSize:     10,
    fontFamily:   "Helvetica-Bold",
    color:        C.dark,
    textAlign:    "right",
    marginBottom: 2,
  },
  companyDetail: {
    fontSize:     7,
    color:        C.muted,
    textAlign:    "right",
    marginBottom: 1.5,
  },

  // ── Info grid ─────────────────────────────────────────────────────────────────
  infoGrid: {
    borderWidth:  1,
    borderColor:  C.border,
    marginBottom: 16,
  },
  infoGridRow: {
    flexDirection: "row",
  },
  infoGridCell: {
    flex:              1,
    paddingVertical:   7,
    paddingHorizontal: 11,
    borderRightWidth:  1,
    borderRightColor:  C.border,
    backgroundColor:   C.light,
  },
  infoGridCellLast: {
    borderRightWidth: 0,
  },
  infoGridCellBottom: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  infoGridLabel: {
    fontSize:      6,
    fontFamily:    "Helvetica-Bold",
    color:         C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom:  3,
  },
  infoGridValue: {
    fontSize:   9,
    fontFamily: "Helvetica-Bold",
    color:      C.text,
    lineHeight: 1.4,
  },
  infoGridSubValue: {
    fontSize:   7.5,
    color:      C.muted,
    marginTop:  1.5,
    lineHeight: 1.35,
  },
  totalPriceValue: {
    fontSize:   12,
    fontFamily: "Helvetica-Bold",
    color:      C.accent,
  },

  // ── Section heading ───────────────────────────────────────────────────────────
  sectionHeading: {
    fontSize:      8,
    fontFamily:    "Helvetica-Bold",
    color:         C.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom:  5,
  },
  scopeText: {
    fontSize:     7.5,
    color:        C.text,
    lineHeight:   1.5,
    marginBottom: 14,
  },

  // ── Line items table ──────────────────────────────────────────────────────────
  tableContainer: {
    marginBottom: 14,
  },
  tableHead: {
    flexDirection:     "row",
    backgroundColor:   C.accent,
    paddingVertical:   6,
    paddingHorizontal: 9,
  },
  tableRow: {
    flexDirection:     "row",
    paddingVertical:   6,
    paddingHorizontal: 9,
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
  tdBold: {
    fontSize:   8,
    fontFamily: "Helvetica-Bold",
    color:      C.dark,
  },
  tdText: {
    fontSize: 8,
    color:    C.text,
  },
  tdMuted: {
    fontSize:   7,
    color:      C.muted,
    marginLeft: 4,
  },
  colItem:  { flex: 1.8 },
  colDesc:  { flex: 4, flexDirection: "row", alignItems: "center" },
  colQty:   { flex: 0.7, textAlign: "right" },
  colPrice: { flex: 1.4, textAlign: "right" },
  colTotal: { flex: 1.4, textAlign: "right" },

  // ── Totals ───────────────────────────────────────────────────────────────────
  totalsSection: {
    alignItems:   "flex-end",
    marginBottom: 14,
  },
  totalRow: {
    flexDirection:  "row",
    justifyContent: "flex-end",
    marginBottom:   3,
    minWidth:       210,
  },
  totalLabel: {
    fontSize:     8,
    color:        C.muted,
    width:        95,
    textAlign:    "right",
    paddingRight: 14,
  },
  totalValue: {
    fontSize:  8,
    width:     85,
    textAlign: "right",
  },
  grandTotalBand: {
    flexDirection:     "row",
    backgroundColor:   C.accent,
    paddingVertical:   9,
    paddingHorizontal: 14,
    minWidth:          210,
    marginTop:         5,
  },
  grandTotalLabel: {
    color:        C.white,
    fontSize:     9,
    fontFamily:   "Helvetica-Bold",
    flex:         1,
    textAlign:    "right",
    paddingRight: 14,
  },
  grandTotalValue: {
    color:      C.white,
    fontSize:   11,
    fontFamily: "Helvetica-Bold",
    width:      85,
    textAlign:  "right",
  },

  // ── Payment schedule ─────────────────────────────────────────────────────────
  paymentRow: {
    flexDirection:     "row",
    justifyContent:    "space-between",
    paddingVertical:   4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  paymentLabel: {
    fontSize: 8,
    color:    C.text,
    flex:     1,
  },
  paymentAmount: {
    fontSize:   8,
    fontFamily: "Helvetica-Bold",
    color:      C.dark,
    width:      75,
    textAlign:  "right",
  },

  // ── Notes box ────────────────────────────────────────────────────────────────
  notesBox: {
    backgroundColor:   C.light,
    borderLeftWidth:   3,
    borderLeftColor:   C.accent,
    paddingVertical:   8,
    paddingHorizontal: 11,
    marginBottom:      14,
  },
  notesLabel: {
    fontSize:      7,
    fontFamily:    "Helvetica-Bold",
    color:         C.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom:  4,
  },
  notesText: {
    fontSize:   7.5,
    color:      C.dark,
    lineHeight: 1.5,
  },

  // ── Signature ────────────────────────────────────────────────────────────────
  signatureSection: {
    marginTop: 10,
  },
  signatureRow: {
    flexDirection: "row",
    gap:           32,
  },
  signatureField: {
    flex: 1,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: C.muted,
    marginBottom:      4,
    height:            20,
  },
  signatureLabel: {
    fontSize: 7,
    color:    C.muted,
  },

  // ── Footer ───────────────────────────────────────────────────────────────────
  footer: {
    position:       "absolute",
    bottom:         24,
    left:           40,
    right:          40,
    flexDirection:  "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop:     6,
  },
  footerText: {
    fontSize: 7,
    color:    C.muted,
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
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

  const sortedPaymentSteps = [...(estimate.payment_steps ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )

  return (
    <Document title={estimate.title} author={company.company_name ?? ""}>
      <Page size="LETTER" style={styles.page}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.estimateTitle}>ESTIMATE</Text>
          <View style={styles.headerRight}>
            {company.logo_url ? (
              <Image src={company.logo_url} style={styles.logo} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>{initials}</Text>
              </View>
            )}
            {company.company_name && (
              <Text style={styles.companyName}>{company.company_name}</Text>
            )}
            {company.phone    && <Text style={styles.companyDetail}>{company.phone}</Text>}
            {company.email    && <Text style={styles.companyDetail}>{company.email}</Text>}
            {company.license_number && (
              <Text style={styles.companyDetail}>Lic# {company.license_number}</Text>
            )}
          </View>
        </View>

        {/* ── Info grid ──────────────────────────────────────────────── */}
        <View style={styles.infoGrid}>
          <View style={styles.infoGridRow}>
            <View style={styles.infoGridCell}>
              <Text style={styles.infoGridLabel}>Prepared For</Text>
              <Text style={styles.infoGridValue}>{customer.name}</Text>
            </View>
            <View style={styles.infoGridCell}>
              <Text style={styles.infoGridLabel}>Project Address</Text>
              <Text style={styles.infoGridValue}>{customer.address ?? "—"}</Text>
            </View>
            <View style={[styles.infoGridCell, styles.infoGridCellLast]}>
              <Text style={styles.infoGridLabel}>Phone / Email</Text>
              {customer.phone && <Text style={styles.infoGridValue}>{customer.phone}</Text>}
              {customer.email && <Text style={styles.infoGridSubValue}>{customer.email}</Text>}
              {!customer.phone && !customer.email && <Text style={styles.infoGridValue}>—</Text>}
            </View>
          </View>
          <View style={styles.infoGridRow}>
            <View style={[styles.infoGridCell, styles.infoGridCellBottom]}>
              <Text style={styles.infoGridLabel}>Project</Text>
              <Text style={styles.infoGridValue}>{estimate.title}</Text>
            </View>
            <View style={[styles.infoGridCell, styles.infoGridCellBottom]}>
              <Text style={styles.infoGridLabel}>Estimate Date</Text>
              <Text style={styles.infoGridValue}>{date}</Text>
            </View>
            <View style={[styles.infoGridCell, styles.infoGridCellLast, styles.infoGridCellBottom]}>
              <Text style={styles.infoGridLabel}>Total Price</Text>
              <Text style={styles.totalPriceValue}>{fmt(Number(estimate.total))}</Text>
            </View>
          </View>
        </View>

        {/* ── Scope of work ───────────────────────────────────────────── */}
        {estimate.scope_of_work && (
          <View>
            <Text style={styles.sectionHeading}>Scope Overview</Text>
            <Text style={styles.scopeText}>{estimate.scope_of_work}</Text>
          </View>
        )}

        {/* ── Line items table (only if items exist) ──────────────────── */}
        {lineItems.length > 0 && (
          <View style={styles.tableContainer}>
            <View style={styles.tableHead}>
              <Text style={[styles.thText, styles.colItem]}>Work Item</Text>
              <Text style={[styles.thText, { flex: 4 }]}>Description</Text>
              <Text style={[styles.thText, styles.colQty,   { textAlign: "right" }]}>Qty</Text>
              <Text style={[styles.thText, styles.colPrice, { textAlign: "right" }]}>Unit Price</Text>
              <Text style={[styles.thText, styles.colTotal, { textAlign: "right" }]}>Amount</Text>
            </View>
            {lineItems.map((item, i) => {
              const isNonTaxable = item.taxable === false
              return (
                <View key={item.id} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowEven : {}]}>
                  <Text style={[styles.tdBold, styles.colItem]}>{i + 1}.</Text>
                  <View style={styles.colDesc}>
                    <Text style={styles.tdText}>{item.description}</Text>
                    {isNonTaxable && estimate.tax_percent > 0 && (
                      <Text style={styles.tdMuted}>(NT)</Text>
                    )}
                  </View>
                  <Text style={[styles.tdText, styles.colQty,   { textAlign: "right" }]}>{item.quantity}</Text>
                  <Text style={[styles.tdText, styles.colPrice, { textAlign: "right" }]}>{fmt(item.unit_price)}</Text>
                  <Text style={[styles.tdText, styles.colTotal, { textAlign: "right" }]}>{fmt(item.quantity * item.unit_price)}</Text>
                </View>
              )
            })}
          </View>
        )}

        {/* ── Bottom block: totals + payment schedule + signatures ─────────
             wrap={false} keeps these together — if they don't fit on the
             current page they move as a unit to the next page.            */}
        <View wrap={false}>

          {/* Totals */}
          <View style={styles.totalsSection}>
            {lineItems.length > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>{fmt(Number(estimate.subtotal))}</Text>
              </View>
            )}
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
                <Text style={[styles.totalLabel, { fontSize: 6.5, color: C.muted, width: 200 }]}>
                  * Tax applies to taxable items only. NT = non-taxable.
                </Text>
              </View>
            )}
            <View style={styles.grandTotalBand}>
              <Text style={styles.grandTotalLabel}>TOTAL</Text>
              <Text style={styles.grandTotalValue}>{fmt(Number(estimate.total))}</Text>
            </View>
          </View>

          {/* Payment schedule */}
          {sortedPaymentSteps.length > 0 && (
            <View style={{ marginBottom: 14 }}>
              <Text style={styles.sectionHeading}>Payment Schedule</Text>
              {sortedPaymentSteps.map((step, i) => (
                <View key={i} style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>{step.name}</Text>
                  <Text style={styles.paymentAmount}>{fmt(step.amount)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Notes */}
          {estimate.notes && (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>Notes</Text>
              <Text style={styles.notesText}>{estimate.notes}</Text>
            </View>
          )}

          {/* Approval link */}
          {estimate.approval_link && (
            <View style={[styles.notesBox, { borderLeftColor: C.dark, marginBottom: 14 }]}>
              <Text style={[styles.notesLabel, { color: C.dark }]}>Approve This Estimate</Text>
              <Text style={[styles.notesText, { marginBottom: 4 }]}>
                Review and approve your estimate online:
              </Text>
              <Link src={estimate.approval_link} style={{ fontSize: 7.5, color: C.dark }}>
                {estimate.approval_link}
              </Link>
            </View>
          )}

          {/* Signature lines */}
          <View style={styles.signatureSection}>
            <View style={styles.signatureRow}>
              <View style={styles.signatureField}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Accepted By</Text>
              </View>
              <View style={styles.signatureField}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Date</Text>
              </View>
              <View style={styles.signatureField}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Authorized Signature</Text>
              </View>
            </View>
          </View>

        </View>
        {/* end wrap={false} bottom block */}

        {/* ── Footer ─────────────────────────────────────────────────── */}
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
