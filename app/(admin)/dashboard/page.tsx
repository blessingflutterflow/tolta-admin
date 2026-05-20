'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Store, ShoppingBag, Users, TrendingUp, Clock } from 'lucide-react'
import StatsCard from '@/components/StatsCard'
import StatusBadge from '@/components/StatusBadge'

interface Order {
  id: string
  paymentRef?: string
  status: string
  total: number
  deliveryAddress?: string
  createdAt: { toDate?: () => Date } | null
}

interface Vendor {
  id: string
  storeName: string
  status: string
}

export default function DashboardPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [users, setUsers] = useState(0)

  useEffect(() => {
    const unsubVendors = onSnapshot(collection(db, 'vendors'), snap => {
      setVendors(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendor)))
    })
    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(20)),
      snap => setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)))
    )
    const unsubUsers = onSnapshot(collection(db, 'users'), snap => setUsers(snap.size))
    return () => { unsubVendors(); unsubOrders(); unsubUsers() }
  }, [])

  const activeVendors = vendors.filter(v => v.status === 'active').length
  const pendingVendors = vendors.filter(v => v.status === 'pending').length
  const todayRevenue = orders
    .filter(o => o.status === 'delivered')
    .reduce((s, o) => s + (o.total || 0), 0)

  function timeAgo(o: Order) {
    if (!o.createdAt?.toDate) return ''
    const diff = Date.now() - o.createdAt.toDate().getTime()
    const m = Math.floor(diff / 60000)
    if (m < 60) return `${m}m ago`
    return `${Math.floor(m / 60)}h ago`
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-1">Welcome back — here's what's happening on Tolta</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard label="Today's Revenue" value={`R${todayRevenue.toFixed(0)}`} icon={TrendingUp} accent />
        <StatsCard label="Total Orders" value={orders.length} icon={ShoppingBag} />
        <StatsCard label="Active Vendors" value={activeVendors}
          sub={pendingVendors > 0 ? `${pendingVendors} pending approval` : undefined}
          icon={Store} />
        <StatsCard label="Total Users" value={users} icon={Users} />
      </div>

      {/* Pending vendors alert */}
      {pendingVendors > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-yellow-50 border border-yellow-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">
              {pendingVendors} vendor application{pendingVendors > 1 ? 's' : ''} waiting for approval
            </span>
          </div>
          <a href="/vendors?filter=pending" className="text-sm font-semibold text-yellow-700 hover:underline">
            Review →
          </a>
        </div>
      )}

      {/* Recent orders */}
      <div className="bg-white rounded-2xl border border-zinc-200">
        <div className="px-6 py-4 border-b border-zinc-100">
          <h2 className="font-semibold text-zinc-900">Recent Orders</h2>
        </div>
        {orders.length === 0 ? (
          <div className="py-12 text-center text-zinc-400 text-sm">No orders yet</div>
        ) : (
          <div className="divide-y divide-zinc-50">
            {orders.slice(0, 10).map(order => (
              <div key={order.id} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
                    <ShoppingBag size={14} className="text-[#FFD230]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {order.paymentRef || order.id.substring(0, 8).toUpperCase()}
                    </p>
                    <p className="text-xs text-zinc-400">{order.deliveryAddress || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <StatusBadge status={order.status} />
                  <span className="text-sm font-semibold text-zinc-900">R{(order.total || 0).toFixed(2)}</span>
                  <span className="text-xs text-zinc-400 w-16 text-right">{timeAgo(order)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
