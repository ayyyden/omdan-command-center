import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Assistant API: authenticated via x-assistant-secret header, never by user session.
  // Bypass BEFORE the Supabase call so the route can never be caught by the login redirect.
  if (pathname.startsWith("/api/assistant/")) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isPublicPath =
    pathname === "/login" ||
    pathname === "/access-denied" ||
    pathname.startsWith("/sign-contract/") ||
    pathname.startsWith("/approve-estimate/") ||
    pathname.startsWith("/approve-change-order/") ||
    pathname.startsWith("/sign-bundle/") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/api/contracts/sign/") ||
    pathname.startsWith("/api/estimates/approve") ||
    pathname.startsWith("/api/change-orders/approve")

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  // Exclude static assets and the pdfjs worker file so they are served directly
  // without auth logic. The worker must be reachable by unauthenticated users
  // (e.g. customers opening a signing link) — without this exclusion, Vercel
  // runs the proxy before serving public/ files and redirects the worker fetch
  // to /login, returning HTML instead of JS.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pdf\\.worker|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
