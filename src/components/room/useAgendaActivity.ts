"use client";

import { useMemo } from "react";
import { useRoom } from "@/lib/store";

/** 안건별로 지금 보고 있는 / 입력 중인 다른 멤버 (목록·마인드맵 공용) */
export function useAgendaActivity() {
  const presence = useRoom((s) => s.presence);
  const typing = useRoom((s) => s.typing);
  const userId = useRoom((s) => s.userId);

  const viewers = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [uid, p] of Object.entries(presence)) {
      if (uid === userId || !p.agendaId) continue;
      (map[p.agendaId] ??= []).push(uid);
    }
    return map;
  }, [presence, userId]);

  const typers = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [uid, t] of Object.entries(typing)) (map[t.agendaId] ??= []).push(uid);
    return map;
  }, [typing]);

  return { viewers, typers };
}
