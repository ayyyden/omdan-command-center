"use client"

import { createContext, useContext } from "react"
import type { TeamRole } from "@/lib/permissions"

const UserRoleContext = createContext<TeamRole | null>(null)

export function UserRoleProvider({ role, children }: { role: TeamRole; children: React.ReactNode }) {
  return <UserRoleContext.Provider value={role}>{children}</UserRoleContext.Provider>
}

export function useUserRole(): TeamRole | null {
  return useContext(UserRoleContext)
}
