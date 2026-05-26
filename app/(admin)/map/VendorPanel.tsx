'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, addDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  X, Plus, Package, ShoppingBag, Pencil, Trash2,
  ToggleLeft, ToggleRight, Check,
} from 'lucide-react'

interface Vendor {
  id: string
  storeName: string
  storeType: string
  address: string
  isOpen: boolean
  status: string
}

interface Product {
  id: string
  name: string
  description: string
  category: string
  price: number
  stock: number
  unit: string
  isActive: boolean
}

interface Order {
  id: string
  status: string
  total: number
  items: Array<{ name: string; quantity: number; price: number }>
  deliveryAddress: string
  createdAt: { toDate?: () => Date } | null
  paymentRef?: string
}

const CATEGORIES = [
  'Produce', 'Dairy', 'Beverages', 'Grains & Staples',
  'Household', 'Snacks', 'Frozen', 'Personal Care',
  'Bakery', 'Meat & Poultry', 'Canned Goods', 'Other',
]
const UNITS = ['each', 'kg', 'g', 'L', 'ml', 'pack', 'box', 'dozen', 'bag']

type Tab = 'products' | 'orders'

interface ProductForm {
  name: string
  description: string
  category: string
  price: string
  stock: string
  unit: string
  isActive: boolean
}

const emptyForm: ProductForm = {
  name: '', description: '', category: 'Produce',
  price: '', stock: '', unit: 'each', isActive: true,
}

export default function VendorPanel({
  vendor,
  onClose,
}: {
  vendor: Vendor
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('products')
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    const q = query(collection(db, 'products'), where('vendorId', '==', vendor.id))
    return onSnapshot(q, snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)))
    })
  }, [vendor.id])

  useEffect(() => {
    if (tab !== 'orders') return
    const q = query(collection(db, 'orders'), where('vendorId', '==', vendor.id))
    return onSnapshot(q, snap => {
      setOrders(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Order))
          .sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0))
      )
    })
  }, [vendor.id, tab])

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(p: Product) {
    setForm({
      name: p.name, description: p.description, category: p.category,
      price: p.price.toString(), stock: p.stock.toString(),
      unit: p.unit, isActive: p.isActive,
    })
    setEditingId(p.id)
    setShowForm(true)
  }

  async function saveProduct() {
    if (!form.name.trim() || !form.price) return
    setSaving(true)
    const data = {
      vendorId: vendor.id,
      name: form.name.trim(),
      description: form.description.trim(),
      category: form.category,
      price: parseFloat(form.price) || 0,
      stock: parseInt(form.stock) || 0,
      unit: form.unit,
      isActive: form.isActive,
      updatedAt: serverTimestamp(),
    }
    try {
      if (editingId) {
        await updateDoc(doc(db, 'products', editingId), data)
      } else {
        await addDoc(collection(db, 'products'), { ...data, createdAt: serverTimestamp() })
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(p: Product) {
    await updateDoc(doc(db, 'products', p.id), {
      isActive: !p.isActive,
      updatedAt: serverTimestamp(),
    })
  }

  async function deleteProduct(id: string) {
    setDeletingId(id)
    try {
      await deleteDoc(doc(db, 'products', id))
    } finally {
      setDeletingId(null)
      setConfirmDelete(null)
    }
  }

  return (
    <div className="absolute top-0 right-0 h-full w-[420px] bg-white shadow-2xl flex flex-col z-10 border-l border-zinc-200">
      {/* Header */}
      <div className="px-5 py-4 bg-black text-white flex items-start justify-between flex-shrink-0">
        <div>
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-0.5">Vendor</p>
          <h2 className="font-bold text-base leading-tight">{vendor.storeName}</h2>
          <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-[300px]">
            {vendor.storeType} · {vendor.address}
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className={`w-2 h-2 rounded-full ${vendor.isOpen ? 'bg-green-400' : 'bg-zinc-500'}`} />
            <span className="text-xs text-zinc-400">{vendor.isOpen ? 'Open' : 'Closed'}</span>
            <span className="text-zinc-700 mx-1">·</span>
            <span className={`text-xs capitalize ${
              vendor.status === 'active' ? 'text-green-400' :
              vendor.status === 'suspended' ? 'text-red-400' : 'text-yellow-400'
            }`}>{vendor.status}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors mt-0.5">
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-100 flex-shrink-0">
        {(['products', 'orders'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? 'text-black border-b-2 border-black'
                : 'text-zinc-400 hover:text-zinc-600'
            }`}
          >
            {t === 'products' ? `Products (${products.length})` : `Orders (${orders.length})`}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── PRODUCTS TAB ─────────────────────────────────────── */}
        {tab === 'products' && (
          <>
            <div className="p-3 border-b border-zinc-50">
              <button
                onClick={showForm && !editingId ? () => setShowForm(false) : openAdd}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#FFD230] text-black text-sm font-semibold hover:bg-yellow-300 transition-colors"
              >
                <Plus size={15} />
                {showForm && !editingId ? 'Cancel' : 'Add Product'}
              </button>
            </div>

            {/* Inline form */}
            {showForm && (
              <div className="mx-3 mt-3 mb-1 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                  {editingId ? 'Edit Product' : 'New Product'}
                </p>
                <div className="space-y-2.5">
                  <input
                    placeholder="Product name *"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 bg-white"
                  />
                  <input
                    placeholder="Description"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 bg-white"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-sm text-zinc-400">R</span>
                      <input
                        type="number" min="0" step="0.01"
                        placeholder="Price *"
                        value={form.price}
                        onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                        className="w-full pl-7 pr-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 bg-white"
                      />
                    </div>
                    <input
                      type="number" min="0"
                      placeholder="Stock qty"
                      value={form.stock}
                      onChange={e => setForm(f => ({ ...f, stock: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 bg-white"
                    >
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <select
                      value={form.unit}
                      onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                      className="px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 bg-white"
                    >
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                      className="rounded accent-black"
                    />
                    <span className="text-zinc-600">Active (visible to customers)</span>
                  </label>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => { setShowForm(false); setEditingId(null) }}
                    className="flex-1 py-2 text-sm border border-zinc-200 rounded-lg text-zinc-500 hover:bg-zinc-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveProduct}
                    disabled={saving || !form.name.trim() || !form.price}
                    className="flex-1 py-2 text-sm bg-black text-[#FFD230] rounded-lg font-semibold hover:bg-zinc-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {saving ? '…' : <><Check size={13} /> {editingId ? 'Save Changes' : 'Add Product'}</>}
                  </button>
                </div>
              </div>
            )}

            {products.length === 0 && !showForm ? (
              <div className="py-16 text-center text-zinc-400">
                <Package size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">No products yet</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-50 pb-4">
                {products.map(p => (
                  <div key={p.id}>
                    <div className={`px-4 py-3 flex items-center gap-3 transition-opacity ${!p.isActive ? 'opacity-40' : ''}`}>
                      <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center flex-shrink-0">
                        <Package size={15} className="text-zinc-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 truncate">{p.name}</p>
                        <p className="text-xs text-zinc-400">
                          R{p.price.toFixed(2)} · {p.stock} {p.unit} · {p.category}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => toggleActive(p)}
                          title={p.isActive ? 'Deactivate' : 'Activate'}
                          className={`p-1.5 rounded-lg transition-colors ${
                            p.isActive ? 'text-green-500 hover:bg-green-50' : 'text-zinc-300 hover:bg-zinc-100'
                          }`}
                        >
                          {p.isActive ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                        </button>
                        <button
                          onClick={() => openEdit(p)}
                          title="Edit"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(p.id)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {/* Inline delete confirm */}
                    {confirmDelete === p.id && (
                      <div className="mx-4 mb-2 px-3 py-2 bg-red-50 rounded-lg border border-red-100 flex items-center justify-between">
                        <p className="text-xs text-red-600">Delete &ldquo;{p.name}&rdquo;?</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-zinc-500 hover:text-zinc-700 px-2 py-1"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => deleteProduct(p.id)}
                            disabled={deletingId === p.id}
                            className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded disabled:opacity-50"
                          >
                            {deletingId === p.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── ORDERS TAB ───────────────────────────────────────── */}
        {tab === 'orders' && (
          <>
            {orders.length === 0 ? (
              <div className="py-16 text-center text-zinc-400">
                <ShoppingBag size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">No orders yet</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-50 pb-4">
                {orders.map(o => (
                  <div key={o.id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-zinc-900">
                        {o.paymentRef || o.id.substring(0, 8).toUpperCase()}
                      </p>
                      <OrderBadge status={o.status} />
                    </div>
                    <p className="text-xs text-zinc-500">
                      {o.items?.length ?? 0} item{o.items?.length !== 1 ? 's' : ''} · R{(o.total || 0).toFixed(2)}
                    </p>
                    {o.deliveryAddress && (
                      <p className="text-xs text-zinc-400 truncate mt-0.5">{o.deliveryAddress}</p>
                    )}
                    {o.createdAt?.toDate && (
                      <p className="text-xs text-zinc-300 mt-0.5">
                        {o.createdAt.toDate().toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function OrderBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    placed:     'bg-yellow-100 text-yellow-700',
    confirmed:  'bg-blue-100 text-blue-700',
    preparing:  'bg-orange-100 text-orange-700',
    ready:      'bg-purple-100 text-purple-700',
    on_the_way: 'bg-indigo-100 text-indigo-700',
    delivered:  'bg-green-100 text-green-700',
    cancelled:  'bg-red-100 text-red-500',
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${map[status] ?? 'bg-zinc-100 text-zinc-500'}`}>
      {status?.replace('_', ' ')}
    </span>
  )
}
