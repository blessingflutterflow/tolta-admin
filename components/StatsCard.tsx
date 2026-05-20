import { LucideIcon } from 'lucide-react'

interface Props {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  accent?: boolean
}

export default function StatsCard({ label, value, sub, icon: Icon, accent }: Props) {
  return (
    <div className={`rounded-2xl p-5 border flex items-start gap-4 ${accent ? 'bg-[#FFD230] border-yellow-300' : 'bg-white border-zinc-200'}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${accent ? 'bg-black/10' : 'bg-zinc-100'}`}>
        <Icon size={20} className={accent ? 'text-black' : 'text-zinc-600'} />
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${accent ? 'text-black/60' : 'text-zinc-500'}`}>{label}</p>
        <p className={`text-2xl font-bold leading-tight mt-0.5 ${accent ? 'text-black' : 'text-zinc-900'}`}>{value}</p>
        {sub && <p className={`text-xs mt-1 ${accent ? 'text-black/50' : 'text-zinc-400'}`}>{sub}</p>}
      </div>
    </div>
  )
}
