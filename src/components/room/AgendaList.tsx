"use client";

import { useMemo, useState } from "react";
import { selectAgenda } from "@/lib/actions";
import { memberColor, showsConclusion, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { formatRelative, toMs } from "@/lib/format";
import { openModal, useRoom } from "@/lib/store";
import type { Agenda, AgendaStatus } from "@/lib/types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { StatusBadge } from "./StatusBadge";

type Filter = "all" | AgendaStatus;

export function AgendaList() {
  const agendas = useRoom((s) => s.agendas);
  const selectedId = useRoom((s) => s.selectedId);
  const unread = useRoom((s) => s.unread);
  const presence = useRoom((s) => s.presence);
  const typing = useRoom((s) => s.typing);
  const members = useRoom((s) => s.members);
  const userId = useRoom((s) => s.userId);
  const me = members[userId];
  const [filter, setFilter] = useState<Filter>("all");

  const sorted = useMemo(
    () => Object.values(agendas).sort((a, b) => toMs(b.last_activity_at) - toMs(a.last_activity_at)),
    [agendas],
  );
  const counts = useMemo(() => {
    const c = { all: sorted.length } as Record<Filter, number>;
    for (const s of STATUS_ORDER) c[s] = 0;
    for (const a of sorted) c[a.status]++;
    return c;
  }, [sorted]);
  const visible = filter === "all" ? sorted : sorted.filter((a) => a.status === filter);

  // 안건별로 지금 보고 있는 / 입력 중인 다른 멤버
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

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-lg">🕯️</span>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">공포게임 기획실</h1>
        <button
          type="button"
          onClick={() => openModal({ kind: "settings" })}
          className="flex max-w-[45%] items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sub hover:bg-hover"
          title="설정"
        >
          <span className="size-2 shrink-0 rounded-full" style={{ background: memberColor(me?.slot) }} />
          <span className="truncate">{me?.nickname}</span>
          <Icon name="settings" className="size-3.5 shrink-0 text-muted" />
        </button>
      </header>

      <div className="flex flex-wrap gap-1 px-3 pt-3 pb-2">
        {(["all", ...STATUS_ORDER] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
              filter === f ? "bg-fg text-bg" : "text-sub hover:bg-hover"
            }`}
          >
            {f === "all" ? "전체" : STATUS_LABEL[f]}
            <span className={`ml-1 ${filter === f ? "text-bg/60" : "text-muted"}`}>{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="px-3 pb-2">
        <Button variant="secondary" className="w-full" onClick={() => openModal({ kind: "agenda" })}>
          <Icon name="plus" /> 새 안건
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="안건 목록">
        {visible.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm whitespace-pre-line text-muted">
            {sorted.length === 0 ? "아직 안건이 없어요.\n첫 안건을 만들어 보세요." : "이 상태의 안건이 없어요."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {visible.map((a) => (
              <AgendaItem
                key={a.id}
                agenda={a}
                selected={a.id === selectedId}
                unread={unread[a.id] ?? 0}
                viewerSlots={(viewers[a.id] ?? []).map((uid) => ({
                  uid,
                  slot: members[uid]?.slot,
                  name: members[uid]?.nickname ?? "",
                }))}
                typingNames={(typers[a.id] ?? []).map((uid) => members[uid]?.nickname ?? "")}
              />
            ))}
          </ul>
        )}
      </nav>
    </>
  );
}

function AgendaItem({
  agenda,
  selected,
  unread,
  viewerSlots,
  typingNames,
}: {
  agenda: Agenda;
  selected: boolean;
  unread: number;
  viewerSlots: { uid: string; slot?: number; name: string }[];
  typingNames: string[];
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => selectAgenda(agenda.id)}
        aria-current={selected ? "true" : undefined}
        className={`group w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
          selected ? "bg-elev ring-1 ring-line" : "hover:bg-hover/60"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm ${unread > 0 ? "font-semibold text-fg" : "text-sub"} ${selected ? "text-fg" : ""}`}
          >
            {agenda.title}
          </span>
          {unread > 0 && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-white tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
        {showsConclusion(agenda.status, agenda.conclusion) && (
          <p className="mt-1 line-clamp-1 text-xs text-ok/90">→ {agenda.conclusion}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
          <StatusBadge status={agenda.status} small />
          {typingNames.length > 0 ? (
            <span className="truncate text-sub">✎ {typingNames.join(", ")} 입력 중</span>
          ) : (
            <span>{formatRelative(agenda.last_activity_at)}</span>
          )}
          <span className="ml-auto flex shrink-0 -space-x-0.5">
            {viewerSlots.map((v) => (
              <span
                key={v.uid}
                title={`${v.name} 님이 보는 중`}
                className="size-2 rounded-full ring-2 ring-panel"
                style={{ background: memberColor(v.slot) }}
              />
            ))}
          </span>
        </div>
      </button>
    </li>
  );
}
