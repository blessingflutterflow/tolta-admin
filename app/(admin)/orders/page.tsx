'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ShoppingBag, MapPin } from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'

interface Order {
  id: string
  paymentRef?: string
  userId: string
  vendorId: string
  items: Array<{ name: string; quantity: number; price: number }>
  subtotal: number
  deliveryFee: number
  total: number
  status: string
  deliveryAddress?: string
  paymentStatus?: string
  createdAt: { toDate?: () => Date } | null
}

const STATUS_OPTIONS = ['placed', 'preparing', 'ready', 'delivered', 'cancelled']

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
      snap => setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)))
    )
    return unsub
  }, [])

  async function changeStatus(id: string, status: string) {
    await updateDoc(doc(db, 'orders', id), { status, updatedAt: serverTimestamp() })
  }

  function formatTime(o: Order) {
    if (!o.createdAt?.toDate) return '—'
    return o.createdAt.toDate().toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })
  }

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter)

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Orders</h1>
        <p className="text-zinc-500 text-sm mt-1">Real-time order monitoring across all vendors</p>
      </div>

      {/* Filter */}
      <div className="flex gap-1 mb-6 bg-zinc-100 p-1 rounded-xl w-fit flex-wrap">
        {(['all', ...STATUS_OPTIONS]).map(f => {
          const count = f === 'all' ? orders.length : orders.filter(o => o.status === f).length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                filter === f ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {f} {count > 0 && <span className="ml-1 opacity-60">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-zinc-400 text-sm">No orders</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Order</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Items</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Address</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Total</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Time</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filtered.map(order => (
                <tr
                  key={order.id}
                  className="hover:bg-zinc-50 transition-colors cursor-pointer"
                  onClick={() => setExpanded(expanded === order.id ? null : order.id)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center flex-shrink-0">
                        <ShoppingBag size={13} className="text-[#FFD230]" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">
                          {order.paymentRef || order.id.substring(0, 8).toUpperCase()}
                        </p>
                        <p className="text-xs text-zinc-400 capitalize">{order.paymentStatus || 'pending'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-zinc-700">
                      {order.items?.length ? `${order.items.length} item${order.items.length > 1 ? 's' : ''}` : '—'}
                    </p>
                    {expanded === order.id && order.items && (
                      <ul className="mt-2 space-y-0.5">
                        {order.items.map((item, i) => (
                          <li key={i} className="text-xs text-zinc-500">
                            {item.quantity}× {item.name} — R{(item.price * item.quantity).toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-1">
                      <MapPin size={12} className="text-zinc-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-zinc-600 max-w-[160px] truncate">{order.deliveryAddress || '—'}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-semibold text-zinc-900">R{(order.total || 0).toFixed(2)}</p>
                    <p className="text-xs text-zinc-400">R{(order.deliveryFee || 0).toFixed(0)} delivery</p>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs text-zinc-400">{formatTime(order)}</p>
                  </td>
                  <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                    <select
                      value={order.status}
                      onChange={e => changeStatus(order.id, e.target.value)}
                      className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-zinc-400"
                    >
                      {STATUS_OPTIONS.map(s => (
                        <option key={s} value={s} className="capitalize">{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
