import { NextResponse, type NextRequest } from 'next/server'

const COOKIE = 'coachienta_access'
const YEAR = 60 * 60 * 24 * 365

/**
 * `Secure` only when the connection really is HTTPS.
 *
 * A `Secure` cookie is silently DROPPED over plain HTTP. Browsers exempt
 * `localhost`, so desktop dev looked fine while the phone — the primary device
 * (PRD-000 §4) — could never store the token over the LAN at
 * `http://192.168.x.x:3000`. Every API call then returned 404 and the screen
 * rendered as an empty day, which is indistinguishable from a database outage.
 *
 * Vercel terminates TLS and sets `x-forwarded-proto`, so production keeps
 * `Secure`. This is not gated on NODE_ENV: that describes the build, not the
 * transport, and a production build served over LAN http would break the same way.
 */
export function cookieOptions(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')
  return {
    httpOnly: true,
    secure: proto === 'https',
    sameSite: 'lax' as const,
    maxAge: YEAR,
    path: '/',
  }
}

/**
 * Not authentication — a doorbell. No accounts, no identity, no logout.
 * It exists so anonymous internet traffic can't reach routes that hold the
 * secret key (PRD-001 §3.6).
 */
export function proxy(req: NextRequest) {
  const token = process.env.APP_ACCESS_TOKEN
  if (!token) return NextResponse.next()

  const { pathname, searchParams } = req.nextUrl

  // ?k= grant, from a link or a QR scan
  const k = searchParams.get('k')
  if (k === token) {
    const clean = req.nextUrl.clone()
    clean.searchParams.delete('k')
    clean.pathname = pathname === '/unlock' ? '/' : pathname
    const res = NextResponse.redirect(clean)
    res.cookies.set(COOKIE, token, cookieOptions(req))
    return res
  }

  if (req.cookies.get(COOKIE)?.value === token) return NextResponse.next()
  if (pathname === '/unlock' || pathname === '/api/unlock') return NextResponse.next()

  // Unknown callers get the paste page; API callers get nothing useful.
  return pathname.startsWith('/api/')
    ? new NextResponse(null, { status: 404 })
    : NextResponse.redirect(new URL('/unlock', req.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)'],
}
