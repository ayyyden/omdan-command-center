import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { ThemeProvider } from "@/components/providers/theme-provider"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Omdan Command Center",
  description: "Business management for Omdan Development",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Apply theme class before first paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('omdan-theme')||'light';document.documentElement.setAttribute('data-theme',t);if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body className="h-full bg-background text-foreground">
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  )
}
