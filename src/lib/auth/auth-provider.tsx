"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { SessionData } from "@/lib/auth/session";
import type { Plan, Role, Sector } from "@/generated/prisma/enums";

type AuthValue = {
  user: SessionData["user"];
  organization: SessionData["organization"];
  role: Role;
  plan: Plan;
  sector: Sector;
  isLoading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * La sesion la resuelve el layout del lado del servidor y la baja por props, asi que
 * el cliente nunca arranca sin datos ni parpadea con un spinner. `isLoading` cubre la
 * unica operacion asincrona que expone el hook: el logout.
 */
export function AuthProvider({
  session,
  children,
}: {
  session: SessionData;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const signOut = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // refresh() ademas invalida el cache de Server Components, si no la proxima
    // pantalla podria pintarse con los datos del usuario anterior.
    router.replace("/login");
    router.refresh();
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        user: session.user,
        organization: session.organization,
        role: session.user.role,
        plan: session.organization.plan,
        sector: session.organization.sector,
        isLoading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth() tiene que usarse dentro de <AuthProvider>");
  }
  return context;
}
