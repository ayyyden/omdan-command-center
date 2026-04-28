export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center bg-sidebar"
      style={{
        minHeight: "100dvh",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {children}
    </div>
  )
}
