'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Plus, Trash2, Edit2, Eye, EyeOff, GripVertical } from 'lucide-react'

interface Banner {
  id: string
  eyebrow: string
  title: string
  cta: string
  bgColor: string
  textColor: string
  isActive: boolean
  order: number
  action: { type: string; value: string }
}

const BLANK: Omit<Banner, 'id'> = {
  eyebrow: '',
  title: '',
  cta: 'Shop now',
  bgColor: '#000000',
  textColor: '#FFFFFF',
  isActive: true,
  order: 0,
  action: { type: 'none', value: '' },
}

export default function BannersPage() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [editing, setEditing] = useState<Banner | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'banners'),
      snap => setBanners(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Banner))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      )
    )
    return unsub
  }, [])

  async function save() {
    if (!editing) return
    setSaving(true)
    const { id, ...data } = editing
    if (isNew) {
      await addDoc(collection(db, 'banners'), { ...data, createdAt: serverTimestamp() })
    } else {
      await updateDoc(doc(db, 'banners', id), { ...data, updatedAt: serverTimestamp() })
    }
    setSaving(false)
    setEditing(null)
  }

  async function toggleActive(banner: Banner) {
    await updateDoc(doc(db, 'banners', banner.id), { isActive: !banner.isActive })
  }

  async function deleteBanner(id: string) {
    if (!confirm('Delete this banner?')) return
    await deleteDoc(doc(db, 'banners', id))
  }

  function openNew() {
    setIsNew(true)
    setEditing({ id: '', ...BLANK, order: banners.length })
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Banners</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage home screen promotional banners</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-black text-[#FFD230] text-sm font-semibold hover:bg-zinc-800 transition-colors"
        >
          <Plus size={16} /> Add Banner
        </button>
      </div>

      {/* Banner list */}
      <div className="space-y-3 mb-8">
        {banners.length === 0 && (
          <div className="py-16 text-center text-zinc-400 text-sm bg-white rounded-2xl border border-zinc-200">
            No banners yet — add one above
          </div>
        )}
        {banners.map(banner => (
          <div key={banner.id} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="flex items-center gap-4 p-4">
              <GripVertical size={16} className="text-zinc-300 flex-shrink-0" />
              {/* Preview */}
              <div
                className="w-32 h-16 rounded-xl flex-shrink-0 flex flex-col justify-center px-3"
                style={{ backgroundColor: banner.bgColor }}
              >
                {banner.eyebrow && (
                  <p className="text-xs font-semibold opacity-60" style={{ color: banner.textColor }}>
                    {banner.eyebrow}
                  </p>
                )}
                <p className="text-sm font-bold leading-tight" style={{ color: banner.textColor }}>
                  {banner.title || 'Untitled'}
                </p>
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{banner.title || 'Untitled'}</p>
                <p className="text-xs text-zinc-400">
                  CTA: {banner.cta}  ·  Action: {banner.action?.type || 'none'}
                  {banner.action?.value ? ` → ${banner.action.value}` : ''}
                </p>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleActive(banner)}
                  className={`p-1.5 rounded-lg transition-colors ${banner.isActive ? 'text-green-600 hover:bg-green-50' : 'text-zinc-400 hover:bg-zinc-100'}`}
                  title={banner.isActive ? 'Active' : 'Inactive'}
                >
                  {banner.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button
                  onClick={() => { setIsNew(false); setEditing(banner) }}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => deleteBanner(banner.id)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-zinc-100">
              <h2 className="text-lg font-bold">{isNew ? 'Add Banner' : 'Edit Banner'}</h2>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Eyebrow (e.g. WELCOME OFFER)">
                <input className={input} value={editing.eyebrow}
                  onChange={e => setEditing({ ...editing, eyebrow: e.target.value })} />
              </Field>
              <Field label="Title *">
                <textarea className={`${input} resize-none`} rows={2} value={editing.title}
                  onChange={e => setEditing({ ...editing, title: e.target.value })} />
              </Field>
              <Field label="CTA label">
                <input className={input} value={editing.cta}
                  onChange={e => setEditing({ ...editing, cta: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Background colour">
                  <div className="flex gap-2 items-center">
                    <input type="color" className="w-10 h-10 rounded cursor-pointer border border-zinc-200"
                      value={editing.bgColor}
                      onChange={e => setEditing({ ...editing, bgColor: e.target.value })} />
                    <input className={`${input} flex-1`} value={editing.bgColor}
                      onChange={e => setEditing({ ...editing, bgColor: e.target.value })} />
                  </div>
                </Field>
                <Field label="Text colour">
                  <div className="flex gap-2 items-center">
                    <input type="color" className="w-10 h-10 rounded cursor-pointer border border-zinc-200"
                      value={editing.textColor}
                      onChange={e => setEditing({ ...editing, textColor: e.target.value })} />
                    <input className={`${input} flex-1`} value={editing.textColor}
                      onChange={e => setEditing({ ...editing, textColor: e.target.value })} />
                  </div>
                </Field>
              </div>
              <Field label="On tap action">
                <select className={input} value={editing.action?.type || 'none'}
                  onChange={e => setEditing({ ...editing, action: { ...editing.action, type: e.target.value } })}>
                  <option value="none">None</option>
                  <option value="vendor">Open vendor store</option>
                  <option value="url">Open URL</option>
                  <option value="category">Filter category</option>
                </select>
              </Field>
              {editing.action?.type !== 'none' && (
                <Field label={editing.action?.type === 'vendor' ? 'Vendor ID' : editing.action?.type === 'url' ? 'URL' : 'Category name'}>
                  <input className={input} value={editing.action?.value || ''}
                    placeholder={editing.action?.type === 'vendor' ? 'e.g. abc123' : editing.action?.type === 'url' ? 'https://...' : 'e.g. Produce'}
                    onChange={e => setEditing({ ...editing, action: { ...editing.action, value: e.target.value } })} />
                </Field>
              )}
              <Field label="Display order">
                <input type="number" className={input} value={editing.order}
                  onChange={e => setEditing({ ...editing, order: parseInt(e.target.value) || 0 })} />
              </Field>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={editing.isActive}
                  onChange={e => setEditing({ ...editing, isActive: e.target.checked })} />
                <span className="text-sm font-medium text-zinc-700">Active (visible to users)</span>
              </label>
            </div>
            <div className="p-6 border-t border-zinc-100 flex gap-3">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 hover:bg-zinc-50">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !editing.title}
                className="flex-1 py-2.5 rounded-xl bg-black text-[#FFD230] text-sm font-semibold hover:bg-zinc-800 disabled:opacity-40 transition-colors">
                {saving ? 'Saving…' : isNew ? 'Add Banner' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const input = 'w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  )
}
