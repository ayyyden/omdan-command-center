import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Instrument_Sans, Gilda_Display } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { PwaRegister } from "@/components/providers/pwa-register"
import { DESIGN_BOOT_SCRIPT } from "@/lib/design"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

// Studio design: Instrument Sans for the interface, Gilda Display (classical
// Roman capitals like the OMDAN wordmark, with clear lining figures — job
// titles are street addresses) for titles and the money ledger.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
})

const gilda = Gilda_Display({
  variable: "--font-gilda",
  subsets: ["latin"],
  weight: "400",
})

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1A1E1C",
}

export const metadata: Metadata = {
  title: "Omdan CRM",
  description: "Business management for Omdan Development",
  applicationName: "Omdan CRM",
  appleWebApp: {
    capable: true,
    title: "Omdan CRM",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} ${gilda.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply theme + design before first paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('omdan-theme')||'light';document.documentElement.setAttribute('data-theme',t);if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}` }} />
        <script dangerouslySetInnerHTML={{ __html: DESIGN_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('omdan-rail')==='collapsed')document.documentElement.setAttribute('data-rail','collapsed')}catch(e){}` }} />
      </head>
      <body className="h-full bg-background text-foreground">
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  )
}
