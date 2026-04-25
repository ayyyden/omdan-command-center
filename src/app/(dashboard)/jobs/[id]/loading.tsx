import { Skeleton } from "@/components/ui/skeleton"

export default function JobDetailLoading() {
  return (
    <div>
      <div className="h-16 border-b px-6 flex items-center gap-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-5 w-20" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-56 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
        <Skeleton className="h-40 rounded-lg" />
      </div>
    </div>
  )
}
