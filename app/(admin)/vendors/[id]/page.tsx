'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '@/lib/firebase'
import { use } from 'react'
import { ArrowLeft, Check, X, MapPin, Phone, CreditCard, Building2, Clock, Package, Percent } from 'lucide-react'
import Link from 'next/link'
import StatusBadge from '@/components/StatusBadge'

interface Vendor {
  storeName: string
  storeType: string
  address: string
  phone: string
  status: string
  minOrder: number
  deliveryTime: string
  commissionRate: number
  bankDetails: { bankName: string; accountName: string; accountNumber: string; accountType: string }
  idNumber?: string
  createdAt: { toDate?: () => Date } | null
  paystackSubaccountCode?: string
}

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [orderCount, setOrderCount] = useState(0)
  const [updating, setUpdating] = useState(false)
  const [commissionInput, setCommissionInput] = useState('')
  const [commissionSaving, setCommissionSaving] = useState(false)
  const [commissionMsg, setCommissionMsg] = useState('')

  async function saveCommission() {
    const rate = parseFloat(commissionInput) / 100
    if (isNaN(rate) || rate < 0 || rate > 1) {
      setCommissionMsg('Enter a value between 0 and 100')
      return
    }
    setCommissionSaving(true)
    setCommissionMsg('')
    try {
      const fn = httpsCallable(getFunctions(), 'updateCommission')
      await fn({ vendorId: id, commissionRate: rate })
      setCommissionMsg(`✓ Commission updated to ${commissionInput}%`)
      setCommissionInput('')
    } catch (e) {
      setCommissionMsg(`Error: ${e}`)
    } finally {
      setCommissionSaving(false)
    }
  }

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'vendors', id), snap => {
      if (snap.exists()) setVendor(snap.data() as Vendor)
    })
    getDocs(query(collection(db, 'orders'), where('vendorId', '==', id))).then(s => setOrderCount(s.size))
    return unsub
  }, [id])

  async function updateStatus(status: string) {
    setUpdating(true)
    await updateDoc(doc(db, 'vendors', id), { status, updatedAt: serverTimestamp() })
    setUpdating(false)
  }

  if (!vendor) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-300 border-t-black rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Back */}
      <Link href="/vendors" className="flex items-center gap-2 text-zinc-400 hover:text-zinc-700 text-sm mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to vendors
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-black flex items-center justify-center">
            <Building2 size={24} className="text-[#FFD230]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{vendor.storeName}</h1>
            <p className="text-zinc-500 text-sm">{vendor.storeType}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={vendor.status} />
          {vendor.status === 'pending' && (
            <>
              <button
                onClick={() => updateStatus('active')}
                disabled={updating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black text-[#FFD230] hover:bg-zinc-800 transition-colors text-sm font-semibold disabled:opacity-50"
              >
                <Check size={14} /> Approve Vendor
              </button>
              <button
                onClick={() => updateStatus('suspended')}
                disabled={updating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-sm font-semibold"
              >
                <X size={14} /> Reject
              </button>
            </>
          )}
          {vendor.status === 'active' && (
            <button
              onClick={() => updateStatus('suspended')}
              disabled={updating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-sm font-semibold"
            >
              <X size={14} /> Suspend
            </button>
          )}
          {vendor.status === 'suspended' && (
            <button
              onClick={() => updateStatus('active')}
              disabled={updating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black text-[#FFD230] hover:bg-zinc-800 transition-colors text-sm font-semibold"
            >
              <Check size={14} /> Reinstate
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Store info */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6">
          <h2 className="font-semibold text-zinc-900 mb-4">Store Details</h2>
          <div className="space-y-3">
            <InfoRow icon={MapPin} label="Address" value={vendor.address} />
            <InfoRow icon={Phone} label="Phone" value={vendor.phone} />
            <InfoRow icon={Clock} label="Delivery time" value={vendor.deliveryTime} />
            <InfoRow icon={Package} label="Min order" value={`R${vendor.minOrder}`} />
            <InfoRow icon={CreditCard} label="Commission" value={`${((vendor.commissionRate || 0.1) * 100).toFixed(0)}%`} />
          </div>
        </div>

        {/* Bank details */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6">
          <h2 className="font-semibold text-zinc-900 mb-4">Bank Details</h2>
          <div className="space-y-3">
            <InfoRow icon={Building2} label="Bank" value={vendor.bankDetails?.bankName || '—'} />
            <InfoRow icon={CreditCard} label="Account name" value={vendor.bankDetails?.accountName || '—'} />
            <InfoRow icon={CreditCard} label="Account number" value={vendor.bankDetails?.accountNumber ? `****${vendor.bankDetails.accountNumber.slice(-4)}` : '—'} />
            <InfoRow icon={CreditCard} label="Account type" value={vendor.bankDetails?.accountType || '—'} />
          </div>
        </div>

        {/* Commission */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6">
          <h2 className="font-semibold text-zinc-900 mb-4 flex items-center gap-2">
            <Percent size={16} className="text-zinc-500" /> Commission Rate
          </h2>
          <div className="mb-4 p-3 rounded-xl bg-zinc-50 border border-zinc-200">
            <p className="text-xs text-zinc-500 mb-1">Current rate</p>
            <p className="text-2xl font-bold text-zinc-900">
              {((vendor.commissionRate || 0.10) * 100).toFixed(0)}%
              <span className="text-sm font-normal text-zinc-400 ml-2">Tolta keeps this</span>
            </p>
            <p className="text-xs text-zinc-400 mt-1">
              Vendor receives {(100 - (vendor.commissionRate || 0.10) * 100).toFixed(0)}% — settled T+1
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={commissionInput}
                onChange={e => setCommissionInput(e.target.value)}
                placeholder="New % (e.g. 12)"
                className="w-full px-3 py-2 pr-7 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400"
              />
              <span className="absolute right-2.5 top-2.5 text-zinc-400 text-sm">%</span>
            </div>
            <button
              onClick={saveCommission}
              disabled={commissionSaving || !commissionInput}
              className="px-4 py-2 rounded-xl bg-black text-[#FFD230] text-sm font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-40"
            >
              {commissionSaving ? '…' : 'Save'}
            </button>
          </div>
          {commissionMsg && (
            <p className={`text-xs mt-2 ${commissionMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
              {commissionMsg}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6">
          <h2 className="font-semibold text-zinc-900 mb-4">Activity</h2>
          <div className="space-y-3">
            <InfoRow icon={Package} label="Total orders" value={orderCount.toString()} />
            <InfoRow icon={CreditCard} label="Paystack account" value={vendor.paystackSubaccountCode || 'Not yet created'} />
            <InfoRow icon={Clock} label="Applied"
              value={vendor.createdAt?.toDate ? vendor.createdAt.toDate().toLocaleDateString('en-ZA') : '—'} />
          </div>
        </div>

        {/* Identity */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6">
          <h2 className="font-semibold text-zinc-900 mb-4">Identity Verification</h2>
          <div className="space-y-3">
            <InfoRow icon={CreditCard} label="SA ID number" value={vendor.idNumber ? `${vendor.idNumber.slice(0, 6)}*******` : '—'} />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={15} className="text-zinc-400 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs text-zinc-400">{label}</p>
        <p className="text-sm font-medium text-zinc-900">{value}</p>
      </div>
    </div>
  )
}
