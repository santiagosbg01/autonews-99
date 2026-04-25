import { redirect } from 'next/navigation'

// Analytics is the main landing page. The legacy "Vista General" (groups overview)
// now lives at /grupos.
export default function Home() {
  redirect('/analytics')
}
