"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRanking } from "@/lib/queries";
import type { SessionUser } from "@/lib/types";

type SessionValue = {
  /** null until /auth/me resolves (pages still render, showing their loading state). */
  user: SessionUser | null;
  /** The athlete whose data the views show: yourself, or (for a coach) the selected teammate. */
  athleteId: string | undefined;
  athleteName: string | undefined;
  setAthleteId: (id: string) => void;
};

const SessionContext = createContext<SessionValue | null>(null);
const STORAGE_KEY = "coach.viewedAthlete";

export function SessionProvider({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  const isCoach = user?.role === "coach";
  const ranking = useRanking(isCoach);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  // The stored choice only matters once we know the user is a coach (always after hydration).
  const [restored, setRestored] = useState(false);
  if (isCoach && !restored && typeof window !== "undefined") {
    setRestored(true);
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setSelected(stored);
    } catch {
      /* storage unavailable: fall back to the first athlete */
    }
  }

  const setAthleteId = useCallback((id: string) => {
    setSelected(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<SessionValue>(() => {
    if (!user) return { user: null, athleteId: undefined, athleteName: undefined, setAthleteId };
    if (!isCoach) return { user, athleteId: user.id, athleteName: user.name, setAthleteId };
    const athletes = ranking.data ?? [];
    const current = athletes.find((a) => a.athleteId === selected) ?? athletes[0];
    return { user, athleteId: current?.athleteId, athleteName: current?.name, setAthleteId };
  }, [isCoach, user, ranking.data, selected, setAthleteId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
