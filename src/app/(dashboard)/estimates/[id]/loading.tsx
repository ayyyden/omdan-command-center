import { Skeleton } from "@/components/ui/skeleton"

export default function EstimateDetailLoading() {
  return (
    <div>
      <div className="h-16 border-b px-6 flex items-center gap-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-5 w-16" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="p-4 sm:p-6 space-y-6">
        <Skeleton className="h-10 w-full max-w-xs" />
        <Skeleton className="h-72 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
