import { Skeleton } from "@/components/ui/skeleton"

export default function CustomerDetailLoading() {
  return (
    <div>
      <div className="h-16 border-b px-6 flex items-center gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-20" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-52 rounded-lg" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  )
}
