"use client"

import { createContext, useContext, useEffect, useState } from "react"

type Theme = "light" | "dark"

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark")
  document.documentElement.setAttribute("data-theme", t)
}

const ThemeContext = createContext<{
  theme: Theme
  setTheme: (theme: Theme) => void
}>({ theme: "light", setTheme: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light")

  useEffect(() => {
    const stored = (localStorage.getItem("omdan-theme") as Theme | null) ?? "light"
    setThemeState(stored)
    applyTheme(stored)
  }, [])

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem("omdan-theme", t)
    applyTheme(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
