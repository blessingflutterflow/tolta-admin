'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

export default function Root() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/dashboard' : '/login')
    }
  }, [user, loading, router])

  return (
    <div className="flex h-screen items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-[#FFD230] flex items-center justify-center">
          <span className="text-2xl font-bold text-black">T</span>
        </div>
        <div className="w-5 h-5 border-2 border-[#FFD230] border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  )
}
