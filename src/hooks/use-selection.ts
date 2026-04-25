import { useState, useCallback } from "react"

export function useSelection(allIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (checked: boolean) => setSelected(checked ? new Set(allIds) : new Set()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allIds.join(",")],
  )

  const clear = useCallback(() => setSelected(new Set()), [])

  const allSelected  = allIds.length > 0 && selected.size === allIds.length
  const someSelected = selected.size > 0 && !allSelected

  return { selected, toggle, toggleAll, clear, allSelected, someSelected }
}
