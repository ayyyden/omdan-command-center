import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardSegmentLoading() {
  return (
    <div>
      {/* Topbar skeleton */}
      <div className="h-16 border-b px-6 flex items-center gap-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-48" />
        <div className="ml-auto">
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      {/* Content area skeleton */}
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[420px] w-full rounded-lg" />
      </div>
    </div>
  )
}
