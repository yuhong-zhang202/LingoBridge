import { Skeleton } from 'lingobridge'

export const TextLines = () => (
  <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Skeleton className="w-12 h-[18px] rounded-full" />
    <Skeleton className="w-3/4 h-[15px]" />
    <Skeleton className="w-1/2 h-3" />
  </div>
)

export const CardSkeleton = () => (
  <div style={{ width: 320, background: '#fff', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 14, padding: 16, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <Skeleton className="w-[52px] h-[18px] rounded-full" />
      <Skeleton className="w-[70px] h-2.5" />
    </div>
    <Skeleton className="w-[94%] h-3 mt-3" />
    <Skeleton className="w-[65%] h-3 mt-2" />
  </div>
)
