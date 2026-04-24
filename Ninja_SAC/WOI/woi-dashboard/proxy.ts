import { NextRequest, NextResponse } from 'next/server'

const VALID_CREDENTIALS: Record<string, string> = {
  'santiago': 'ops99mx',
  'ops':      'monitor99',
}

export function proxy(req: NextRequest) {
  const authHeader = req.headers.get('authorization')

  if (authHeader?.startsWith('Basic ')) {
    const base64 = authHeader.slice(6)
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const [user, pass] = decoded.split(':')

    if (VALID_CREDENTIALS[user] === pass) {
      return NextResponse.next()
    }
  }

  return new NextResponse('Acceso restringido', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="WOI 99minutos Ops Intelligence"',
    },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
