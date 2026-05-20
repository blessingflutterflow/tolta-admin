'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Package, ToggleLeft, ToggleRight } from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'

interface Product {
  id: string
  name: string
  category: string
  unit: string
  price: number
  stock: number
  isActive: boolean
  vendorId?: string
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)))
    })
    return unsub
  }, [])

  async function toggleActive(id: string, current: boolean) {
    await updateDoc(doc(db, 'products', id), { isActive: !current })
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Products</h1>
        <p className="text-zinc-500 text-sm mt-1">{products.length} products across all vendors</p>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        {products.length === 0 ? (
          <div className="py-16 text-center text-zinc-400 text-sm">No products yet</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Product</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Category</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Price</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Stock</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Toggle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {products.map(p => (
                <tr key={p.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                        <Package size={14} className="text-zinc-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{p.name}</p>
                        <p className="text-xs text-zinc-400">{p.unit}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{p.category}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-zinc-900">R{p.price?.toFixed(2)}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={p.stock > 0 ? 'active' : 'suspended'} />
                    <span className="ml-2 text-xs text-zinc-400">{p.stock} units</span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={p.isActive ? 'active' : 'suspended'} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => toggleActive(p.id, p.isActive)} className="text-zinc-400 hover:text-zinc-700 transition-colors">
                      {p.isActive
                        ? <ToggleRight size={24} className="text-green-500" />
                        : <ToggleLeft size={24} />}
                    </button>
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
