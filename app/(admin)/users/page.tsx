'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { User } from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'

interface AppUser {
  id: string
  name: string
  phone: string
  role: string
  createdAt: { toDate?: () => Date } | null
}

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)))
    })
    return unsub
  }, [])

  function formatDate(u: AppUser) {
    if (!u.createdAt?.toDate) return '—'
    return u.createdAt.toDate().toLocaleDateString('en-ZA')
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Users</h1>
        <p className="text-zinc-500 text-sm mt-1">{users.length} registered users</p>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        {users.length === 0 ? (
          <div className="py-16 text-center text-zinc-400 text-sm">No users yet</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">User</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Phone</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Joined</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">UID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center">
                        {u.name ? (
                          <span className="text-sm font-semibold text-zinc-700">{u.name[0].toUpperCase()}</span>
                        ) : (
                          <User size={14} className="text-zinc-400" />
                        )}
                      </div>
                      <p className="text-sm font-semibold text-zinc-900">{u.name || 'Unnamed user'}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{u.phone || '—'}</td>
                  <td className="px-6 py-4"><StatusBadge status={u.role || 'consumer'} /></td>
                  <td className="px-6 py-4 text-sm text-zinc-500">{formatDate(u)}</td>
                  <td className="px-6 py-4">
                    <code className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded">{u.id.substring(0, 12)}…</code>
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
