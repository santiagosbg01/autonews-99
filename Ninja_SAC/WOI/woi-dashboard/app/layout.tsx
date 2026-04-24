import type { Metadata } from 'next'
import './globals.css'
import Topbar from './components/Topbar'

export const metadata: Metadata = {
  title: 'WOI — 99minutos Ops Intelligence',
  description: 'Panel interno de inteligencia operativa de grupos WhatsApp',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen">
        <Topbar />

        {/* Page content */}
        <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
