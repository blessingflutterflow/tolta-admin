'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Store, ShoppingBag, Package,
  Users, LogOut, ChevronRight, Image
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

const nav = [
  { label: 'Dashboard',  href: '/dashboard',  icon: LayoutDashboard },
  { label: 'Vendors',    href: '/vendors',     icon: Store },
  { label: 'Orders',     href: '/orders',      icon: ShoppingBag },
  { label: 'Products',   href: '/products',    icon: Package },
  { label: 'Users',      href: '/users',       icon: Users },
  { label: 'Banners',    href: '/banners',     icon: Image },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useAuth()

  async function handleLogout() {
    await signOut()
    router.replace('/login')
  }

  return (
    <aside className="w-60 min-h-screen bg-black flex flex-col border-r border-zinc-800">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#FFD230] flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-bold text-black">T</span>
          </div>
          <div>
            <p className="text-white font-semibold leading-none">Tolta</p>
            <p className="text-zinc-500 text-xs mt-0.5">Admin Dashboard</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
                active
                  ? 'bg-[#FFD230] text-black'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="text-sm font-medium">{label}</span>
              {active && <ChevronRight size={14} className="ml-auto" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-zinc-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Log Out</span>
        </button>
      </div>
    </aside>
  )
}
