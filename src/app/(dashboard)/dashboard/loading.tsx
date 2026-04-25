import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardPageLoading() {
  return (
    <div>
      <div className="h-16 border-b px-6 flex items-center gap-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="p-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        {/* Content cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-52 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  )
}
