import { NextResponse, type NextRequest } from 'next/server'
import { cookieOptions } from '@/proxy'
import { env } from '@/lib/env'

/**
 * Paste-field grant. Needed because an iOS home-screen PWA can hold a separate
 * cookie jar from Safari, so a ?k= link visited in Safari may not carry over.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  if (form.get('token') !== env.APP_ACCESS_TOKEN) {
    return NextResponse.redirect(new URL('/unlock?e=1', req.url), 303)
  }
  const res = NextResponse.redirect(new URL('/', req.url), 303)
  // Same rule as the ?k= grant: Secure only over real HTTPS, or the phone cannot
  // store it over LAN http and every later API call 404s.
  res.cookies.set('coachienta_access', env.APP_ACCESS_TOKEN, cookieOptions(req))
  return res
}
