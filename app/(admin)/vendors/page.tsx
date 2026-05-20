'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useSearchParams } from 'next/navigation'
import { Check, X, Eye, MapPin, Building2 } from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'
import Link from 'next/link'

interface Vendor {
  id: string
  storeName: string
  storeType: string
  address: string
  status: string
  phone: string
  minOrder: number
  deliveryTime: string
  createdAt: { toDate?: () => Date } | null
  bankDetails?: { bankName?: string; accountNumber?: string }
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [filter, setFilter] = useState<string>('all')
  const searchParams = useSearchParams()

  useEffect(() => {
    const f = searchParams.get('filter')
    if (f) setFilter(f)
  }, [searchParams])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'vendors'), snap => {
      setVendors(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendor)))
    })
    return unsub
  }, [])

  async function updateStatus(id: string, status: string) {
    await updateDoc(doc(db, 'vendors', id), {
      status,
      updatedAt: serverTimestamp(),
    })
  }

  const filtered = filter === 'all'
    ? vendors
    : vendors.filter(v => v.status === filter)

  const counts = {
    all: vendors.length,
    pending: vendors.filter(v => v.status === 'pending').length,
    active: vendors.filter(v => v.status === 'active').length,
    suspended: vendors.filter(v => v.status === 'suspended').length,
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Vendors</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage vendor applications and accounts</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 bg-zinc-100 p-1 rounded-xl w-fit">
        {(['all', 'pending', 'active', 'suspended'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === f ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {f} {counts[f] > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${f === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-zinc-200 text-zinc-600'}`}>
                {counts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-zinc-400 text-sm">
            No {filter === 'all' ? '' : filter} vendors
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Store</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Address</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Bank</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filtered.map(vendor => (
                <tr key={vendor.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
                        <Building2 size={16} className="text-[#FFD230]" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{vendor.storeName}</p>
                        <p className="text-xs text-zinc-400">{vendor.storeType} · {vendor.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-1.5">
                      <MapPin size={13} className="text-zinc-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-zinc-600 max-w-[200px] truncate">{vendor.address}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-zinc-600">{vendor.bankDetails?.bankName || '—'}</p>
                    <p className="text-xs text-zinc-400">{vendor.bankDetails?.accountNumber ? `****${vendor.bankDetails.accountNumber.slice(-4)}` : '—'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={vendor.status} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/vendors/${vendor.id}`}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
                        title="View details"
                      >
                        <Eye size={15} />
                      </Link>
                      {vendor.status === 'pending' && (
                        <>
                          <button
                            onClick={() => updateStatus(vendor.id, 'active')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors text-xs font-semibold"
                          >
                            <Check size={13} /> Approve
                          </button>
                          <button
                            onClick={() => updateStatus(vendor.id, 'suspended')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-xs font-semibold"
                          >
                            <X size={13} /> Reject
                          </button>
                        </>
                      )}
                      {vendor.status === 'active' && (
                        <button
                          onClick={() => updateStatus(vendor.id, 'suspended')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-xs font-semibold"
                        >
                          <X size={13} /> Suspend
                        </button>
                      )}
                      {vendor.status === 'suspended' && (
                        <button
                          onClick={() => updateStatus(vendor.id, 'active')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors text-xs font-semibold"
                        >
                          <Check size={13} /> Reinstate
                        </button>
                      )}
                    </div>
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
