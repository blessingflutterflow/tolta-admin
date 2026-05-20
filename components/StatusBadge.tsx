const variants: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  pending:   'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
  cancelled: 'bg-red-100 text-red-700',
  placed:    'bg-blue-100 text-blue-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready:     'bg-green-100 text-green-700',
  delivered: 'bg-zinc-100 text-zinc-500',
  consumer:  'bg-blue-100 text-blue-700',
  vendor:    'bg-purple-100 text-purple-700',
  open:      'bg-green-100 text-green-700',
  closed:    'bg-zinc-100 text-zinc-500',
}

export default function StatusBadge({ status }: { status: string }) {
  const cls = variants[status?.toLowerCase()] ?? 'bg-zinc-100 text-zinc-500'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  )
}
