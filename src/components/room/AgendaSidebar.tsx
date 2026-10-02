"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { memberColor } from "@/lib/constants";
import { isFiltering } from "@/lib/filters";
import { openModal, useRoom } from "@/lib/store";
import { Spinner } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { AgendaFiltersBar } from "./AgendaFiltersBar";

// React Flow + dagre 는 무거워서 따로 불러온다
const MindMap = dynamic(() => import("./MindMap").then((m) => m.MindMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted">
      <Spinner className="size-5" />
    </div>
  ),
});

/** 왼쪽 영역: 방 이름·설정 + 상태 필터 + 안건 마인드맵 */
export function AgendaSidebar() {
  const me = useRoom((s) => s.members[s.userId]);
  const filtering = useRoom((s) => isFiltering(s.filters));
  const [showFilters, setShowFilters] = useState(false);

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

      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`rounded-md px-2 py-1 text-xs transition-colors hover:bg-hover ${
            filtering ? "text-accent-hover" : "text-sub"
          }`}
        >
          상태 필터{filtering ? " ●" : ""}
        </button>
        <span className="ml-auto truncate text-[11px] text-muted">빈 곳 더블클릭: 새 안건 · 노드 +: 하위 안건</span>
      </div>
      {showFilters && <AgendaFiltersBar />}

      <div className="relative mt-2 min-h-0 flex-1 border-t border-line">
        <MindMap />
      </div>
    </>
  );
}
