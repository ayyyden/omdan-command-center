"use client"

import { useTheme } from "@/components/providers/theme-provider"
import { Topbar } from "@/components/shared/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Sun, Moon } from "lucide-react"
import { useDesign, setDesign } from "@/components/providers/design-switch"
import { OmdanMark } from "@/components/brand/omdan-mark"

export default function AppearancePage() {
  const { theme, setTheme } = useTheme()
  const design = useDesign()

  return (
    <div>
      <Topbar title="Appearance" subtitle="Customize the look of your app" />
      <div className="p-4 sm:p-6 max-w-lg space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Look</CardTitle>
            <p className="text-sm text-muted-foreground">Switches instantly on this device. You can change it back any time.</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "studio",  title: "New look", hint: "Omdan brass and basalt" },
                { id: "classic", title: "Classic",  hint: "The original design" },
              ] as const).map((o) => (
                <button
                  key={o.id}
                  onClick={() => setDesign(o.id)}
                  aria-pressed={design === o.id}
                  className={`flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-colors ${
                    design === o.id ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  {o.id === "studio" ? (
                    <div className="w-12 h-12 rounded-xl bg-[#1A1E1C] flex items-center justify-center">
                      <OmdanMark id="appearance" className="w-8 h-8" title="" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-[#4F46E5] flex items-center justify-center text-white text-lg font-bold">O</div>
                  )}
                  <div className="text-center">
                    <p className="text-sm font-semibold">{o.title}</p>
                    <p className="text-xs text-muted-foreground">{o.hint}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Theme</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTheme("light")}
                className={`flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-colors ${
                  theme === "light"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-white border flex items-center justify-center shadow-sm">
                  <Sun className="w-6 h-6 text-amber-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">Light</p>
                  <p className="text-xs text-muted-foreground">Default</p>
                </div>
                {theme === "light" && (
                  <div className="w-2 h-2 rounded-full bg-primary" />
                )}
              </button>

              <button
                onClick={() => setTheme("dark")}
                className={`flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-colors ${
                  theme === "dark"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shadow-sm">
                  <Moon className="w-6 h-6 text-zinc-200" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">Dark</p>
                  <p className="text-xs text-muted-foreground">Easy on the eyes</p>
                </div>
                {theme === "dark" && (
                  <div className="w-2 h-2 rounded-full bg-primary" />
                )}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
