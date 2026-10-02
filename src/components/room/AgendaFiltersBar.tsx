"use client";

import { useMemo } from "react";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { useRoom } from "@/lib/store";

/** 상태 필터 칩. 목록과 마인드맵이 같은 필터(스토어)를 쓴다 */
export function AgendaFiltersBar() {
  const status = useRoom((s) => s.filters.status);
  const agendas = useRoom((s) => s.agendas);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const s of STATUS_ORDER) c[s] = 0;
    for (const a of Object.values(agendas)) {
      c.all++;
      c[a.status]++;
    }
    return c;
  }, [agendas]);

  return (
    <div className="flex flex-wrap gap-1 px-3 pt-3 pb-2">
      {(["all", ...STATUS_ORDER] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => useRoom.setState({ filters: { status: f } })}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
            status === f ? "bg-fg text-bg" : "text-sub hover:bg-hover"
          }`}
        >
          {f === "all" ? "전체" : STATUS_LABEL[f]}
          <span className={`ml-1 ${status === f ? "text-bg/60" : "text-muted"}`}>{counts[f]}</span>
        </button>
      ))}
    </div>
  );
}
