import React from "react"
import {
  Document, Page, Text, View, StyleSheet, Image,
} from "@react-pdf/renderer"

// ── Design tokens (shared palette with estimate-document) ─────────────────────
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
    fontFamily:        "Helvetica",
    fontSize:          9,
    color:             C.dark,
    paddingTop:        48,
    paddingBottom:     72,
    paddingHorizontal: 48,
    lineHeight:        1.4,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "flex-start",
    marginBottom:   24,
  },
  logo: {
    width:     64,
    height:    64,
    objectFit: "contain",
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
    color:      C.white,
    fontSize:   18,
    fontFamily: "Helvetica-Bold",
  },
  companyBlock: {
    alignItems: "flex-end",
    maxWidth:   220,
  },
  companyName: {
    fontSize:     14,
    fontFamily:   "Helvetica-Bold",
    color:        C.dark,
    marginBottom: 3,
    textAlign:    "right",
  },
  companyDetail: {
    fontSize:     8,
    color:        C.muted,
    textAlign:    "right",
    marginBottom: 2,
  },

  // ── Title band ────────────────────────────────────────────────────────────
  titleBand: {
    backgroundColor:   C.dark,
    paddingVertical:   10,
    paddingHorizontal: 14,
    flexDirection:     "row",
    justifyContent:    "space-between",
    alignItems:        "center",
    marginBottom:      24,
  },
  titleText: {
    color:         C.white,
    fontSize:      15,
    fontFamily:    "Helvetica-Bold",
    letterSpacing: 3,
  },
  titleMeta: {
    alignItems: "flex-end",
  },
  titleMetaItem: {
    marginBottom: 5,
    alignItems:   "flex-end",
  },
  titleMetaLabel: {
    color:         "#e8d5a3",
    fontSize:      7,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom:  2,
  },
  titleMetaValue: {
    color:      C.white,
    fontSize:   8,
    fontFamily: "Helvetica-Bold",
  },

  // ── Two-column info row ───────────────────────────────────────────────────
  infoRow: {
    flexDirection: "row",
    marginBottom:  24,
    gap:           24,
  },
  infoBlock: {
    flex: 1,
  },
  infoLabel: {
    fontSize:          7,
    fontFamily:        "Helvetica-Bold",
    color:             C.accent,
    textTransform:     "uppercase",
    letterSpacing:     1,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
    paddingBottom:     3,
    marginBottom:      6,
  },
  infoName: {
    fontSize:     10,
    fontFamily:   "Helvetica-Bold",
    marginBottom: 3,
  },
  infoDetail: {
    fontSize:     8,
    color:        C.muted,
    marginBottom: 2,
  },

  // ── Amount due ────────────────────────────────────────────────────────────
  amountSection: {
    marginBottom: 24,
  },
  amountSectionLabel: {
    fontSize:          7,
    fontFamily:        "Helvetica-Bold",
    color:             C.accent,
    textTransform:     "uppercase",
    letterSpacing:     1,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingBottom:     4,
    marginBottom:      8,
  },
  amountBand: {
    flexDirection:     "row",
    backgroundColor:   C.accent,
    paddingVertical:   12,
    paddingHorizontal: 16,
    justifyContent:    "space-between",
    alignItems:        "center",
  },
  amountTypeLabel: {
    color:      C.white,
    fontSize:   10,
    fontFamily: "Helvetica-Bold",
  },
  amountValue: {
    color:      C.white,
    fontSize:   18,
    fontFamily: "Helvetica-Bold",
  },
  dueDateRow: {
    flexDirection:     "row",
    justifyContent:    "flex-end",
    paddingVertical:   6,
    paddingHorizontal: 16,
    backgroundColor:   C.light,
    borderWidth:       1,
    borderTopWidth:    0,
    borderColor:       C.border,
  },
  dueDateText: {
    fontSize: 8,
    color:    C.muted,
  },

  // ── Notes ─────────────────────────────────────────────────────────────────
  notesBox: {
    backgroundColor:   C.light,
    borderLeftWidth:   3,
    borderLeftColor:   C.accent,
    paddingVertical:   10,
    paddingHorizontal: 12,
    marginBottom:      24,
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

  // ── Payment methods ───────────────────────────────────────────────────────
  paymentBox: {
    borderWidth:       1,
    borderColor:       C.border,
    paddingVertical:   10,
    paddingHorizontal: 12,
    marginBottom:      24,
  },
  paymentLabel: {
    fontSize:      7,
    fontFamily:    "Helvetica-Bold",
    color:         C.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom:  5,
  },
  paymentText: {
    fontSize: 8.5,
    color:    C.dark,
  },
  paymentContact: {
    fontSize:   8,
    color:      C.muted,
    marginTop:  4,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    position:       "absolute",
    bottom:         32,
    left:           48,
    right:          48,
    flexDirection:  "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop:     8,
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

const METHOD_LABELS: Record<string, string> = {
  zelle: "Zelle",
  cash:  "Cash",
  check: "Check",
  venmo: "Venmo",
}
function methodLabel(v: string): string {
  return METHOD_LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InvoicePDFData {
  invoice: {
    id: string
    invoice_number: string | null
    created_at: string
    type: string
    type_label: string
    amount: number
    due_date: string | null
    notes: string | null
    payment_methods: string[]
  }
  customer: {
    name: string
    address: string | null
    phone: string | null
    email: string | null
  }
  job: { title: string | null } | null
  company: {
    company_name: string | null
    phone: string | null
    email: string | null
    license_number: string | null
    logo_url: string | null  // raw URL or base64 data URL
    address: string | null
  }
}

// ── Document ──────────────────────────────────────────────────────────────────

export function InvoicePDFDocument({ invoice, customer, job, company }: InvoicePDFData) {
  const initials = (company.company_name ?? "O")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const issueDate = new Date(invoice.created_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  })

  const dueDate = invoice.due_date
    ? new Date(invoice.due_date + "T00:00:00").toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
    : null

  const paymentLine = invoice.payment_methods.length > 0
    ? invoice.payment_methods.map(methodLabel).join(", ")
    : "Contact us to arrange payment"

  return (
    <Document
      title={`Invoice${invoice.invoice_number ? ` ${invoice.invoice_number}` : ""}`}
      author={company.company_name ?? ""}
    >
      <Page size="LETTER" style={styles.page}>

        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          {company.logo_url ? (
            <Image src={company.logo_url} style={styles.logo} />
          ) : (
            <View style={styles.logoPlaceholder}>
              <Text style={styles.logoPlaceholderText}>{initials}</Text>
            </View>
          )}
          <View style={styles.companyBlock}>
            {company.company_name && (
              <Text style={styles.companyName}>{company.company_name}</Text>
            )}
            {company.phone          && <Text style={styles.companyDetail}>{company.phone}</Text>}
            {company.email          && <Text style={styles.companyDetail}>{company.email}</Text>}
            {company.address        && <Text style={styles.companyDetail}>{company.address}</Text>}
            {company.license_number && (
              <Text style={styles.companyDetail}>Lic# {company.license_number}</Text>
            )}
          </View>
        </View>

        {/* ── Title band ─────────────────────────────────────────── */}
        <View style={styles.titleBand}>
          <Text style={styles.titleText}>INVOICE</Text>
          <View style={styles.titleMeta}>
            {invoice.invoice_number && (
              <View style={styles.titleMetaItem}>
                <Text style={styles.titleMetaLabel}>Invoice #</Text>
                <Text style={styles.titleMetaValue}>{invoice.invoice_number}</Text>
              </View>
            )}
            <View style={styles.titleMetaItem}>
              <Text style={styles.titleMetaLabel}>Date</Text>
              <Text style={styles.titleMetaValue}>{issueDate}</Text>
            </View>
          </View>
        </View>

        {/* ── Bill To + Invoice Details ───────────────────────────── */}
        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Bill To</Text>
            <Text style={styles.infoName}>{customer.name}</Text>
            {customer.address && <Text style={styles.infoDetail}>{customer.address}</Text>}
            {customer.phone   && <Text style={styles.infoDetail}>{customer.phone}</Text>}
            {customer.email   && <Text style={styles.infoDetail}>{customer.email}</Text>}
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Invoice Details</Text>
            {job?.title && <Text style={styles.infoName}>{job.title}</Text>}
            <Text style={styles.infoDetail}>Type: {invoice.type_label}</Text>
            {dueDate && <Text style={styles.infoDetail}>Due: {dueDate}</Text>}
          </View>
        </View>

        {/* ── Amount Due ─────────────────────────────────────────── */}
        <View style={styles.amountSection}>
          <Text style={styles.amountSectionLabel}>Amount Due</Text>
          <View style={styles.amountBand}>
            <Text style={styles.amountTypeLabel}>{invoice.type_label} Invoice</Text>
            <Text style={styles.amountValue}>{fmt(invoice.amount)}</Text>
          </View>
          {dueDate && (
            <View style={styles.dueDateRow}>
              <Text style={styles.dueDateText}>Payment due by {dueDate}</Text>
            </View>
          )}
        </View>

        {/* ── Notes ──────────────────────────────────────────────── */}
        {invoice.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* ── Payment Methods ────────────────────────────────────── */}
        <View style={styles.paymentBox}>
          <Text style={styles.paymentLabel}>Payment Methods Accepted</Text>
          <Text style={styles.paymentText}>{paymentLine}</Text>
          {company.phone && (
            <Text style={styles.paymentContact}>Questions? Call {company.phone}</Text>
          )}
        </View>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {company.company_name ?? ""}
            {company.license_number ? ` · Lic# ${company.license_number}` : ""}
          </Text>
          <Text style={styles.footerText}>Thank you for your business!</Text>
        </View>

      </Page>
    </Document>
  )
}
