"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { selectAgenda } from "@/lib/actions";
import { memberColor } from "@/lib/constants";
import { computeMindMap, NODE_H, NODE_W } from "@/lib/mindmap";
import { defaultFilters, openModal, useRoom } from "@/lib/store";
import type { Agenda } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { useAgendaActivity } from "./useAgendaActivity";

const COLLAPSE_KEY = "mindmap-collapsed";

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

type AgendaNodeData = {
  agenda: Agenda;
  height: number;
  dimmed: boolean;
  selected: boolean;
  unread: number;
  viewers: { uid: string; slot?: number; name: string }[];
  childCount: number;
  hiddenCount: number;
  collapsed: boolean;
  onToggle: (id: string, collapsed: boolean) => void;
};
type AgendaFlowNode = Node<AgendaNodeData, "agenda">;

const AgendaNode = memo(function AgendaNode({ data }: NodeProps<AgendaFlowNode>) {
  const { agenda: a, selected, dimmed, unread, viewers } = data;

  // 클릭은 ReactFlow 의 onNodeClick 이 처리한다 (노드가 클릭을 받으려면 onNodeClick 이 있어야 함)
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Enter") selectAgenda(a.id);
      }}
      title={dimmed ? "필터 조건에는 맞지 않는 상위 안건" : a.title}
      className={`group relative flex cursor-pointer flex-col rounded-xl border bg-elev px-3 py-2.5 text-left shadow-lg shadow-black/40 transition-[border-color,opacity] ${
        selected ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-zinc-500"
      } ${dimmed ? "opacity-40" : ""}`}
      style={{ width: NODE_W, height: data.height }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!pointer-events-none !border-0 !bg-transparent" />

      <div className="flex items-start gap-1.5 pr-6">
        <span className={`line-clamp-1 flex-1 text-[13px] ${unread > 0 ? "font-semibold text-fg" : "font-medium text-fg/90"}`}>
          {a.title}
        </span>
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px]">
        <StatusBadge status={a.status} small />
        <span className="mr-2.5 ml-auto flex shrink-0 -space-x-0.5">
          {viewers.map((v) => (
            <span
              key={v.uid}
              title={`${v.name} 님이 보는 중`}
              className="size-2 rounded-full ring-2 ring-elev"
              style={{ background: memberColor(v.slot) }}
            />
          ))}
        </span>
      </div>

      {/* 하위 안건 추가 */}
      <button
        type="button"
        title="하위 안건 추가"
        aria-label={`${a.title}에 하위 안건 추가`}
        onClick={(e) => {
          e.stopPropagation();
          openModal({ kind: "agenda", parentId: a.id });
        }}
        className="nopan nodrag absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md text-base leading-none text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        +
      </button>

      {/* 접기/펼치기 */}
      {data.childCount > 0 && (
        <button
          type="button"
          title={data.collapsed ? `하위 안건 ${data.hiddenCount}개 펼치기` : "하위 안건 접기"}
          aria-expanded={!data.collapsed}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle(a.id, !data.collapsed);
          }}
          className={`nodrag nopan absolute top-1/2 -right-3 z-10 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-full border px-1 text-[10px] font-semibold transition-colors ${
            data.collapsed
              ? "border-accent/60 bg-accent/15 text-accent-hover hover:bg-accent/25"
              : "border-line bg-panel text-muted hover:text-fg"
          }`}
        >
          {data.collapsed ? `+${data.hiddenCount}` : "−"}
        </button>
      )}

      <Handle type="source" position={Position.Right} isConnectable={false} className="!pointer-events-none !border-0 !bg-transparent" />
    </div>
  );
});

const nodeTypes = { agenda: AgendaNode };

// 노드 크기가 고정이라 크기·연결점 위치를 미리 알려 준다.
// (안 알려 주면 React Flow 가 노드를 새로 받을 때마다 다시 재는 동안 노드를 숨기고 클릭도 막는다)
const NODE_SIZE = { width: NODE_W, height: NODE_H };
const NODE_HANDLES = [
  { type: "target" as const, position: Position.Left, x: 0, y: NODE_H / 2, width: 1, height: 1 },
  { type: "source" as const, position: Position.Right, x: NODE_W - 1, y: NODE_H / 2, width: 1, height: 1 },
];

/**
 * 안건 마인드맵. 데이터는 기존 스토어(Realtime room:db 채널이 채움)만 읽으므로
 * 마인드맵을 위한 별도 구독이 없다.
 */
export function MindMap() {
  const agendas = useRoom((s) => s.agendas);
  const filters = useRoom((s) => s.filters);
  const selectedId = useRoom((s) => s.selectedId);
  const unread = useRoom((s) => s.unread);
  const members = useRoom((s) => s.members);
  const { viewers } = useAgendaActivity();
  const [collapseOverrides, setCollapseOverrides] = useState(readCollapsed);

  const onNodeClick = useCallback((_: unknown, node: AgendaFlowNode) => selectAgenda(node.id), []);

  // 빈 곳을 빠르게 두 번 클릭(탭)하면 최상위 안건 만들기. 모바일 더블탭도 같은 방식으로 잡는다
  const lastPaneClick = useRef(0);
  const onPaneClick = useCallback(() => {
    const now = Date.now();
    if (now - lastPaneClick.current < 400) {
      lastPaneClick.current = 0;
      openModal({ kind: "agenda" });
    } else {
      lastPaneClick.current = now;
    }
  }, []);

  const onToggle = useCallback((id: string, collapsed: boolean) => {
    setCollapseOverrides((prev) => {
      const next = { ...prev, [id]: collapsed };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // 저장 못 해도 이번 화면에서는 동작
      }
      return next;
    });
  }, []);

  // 배치(구조)는 안건·필터·접힘이 바뀔 때만 다시 계산
  const layout = useMemo(
    () => computeMindMap(agendas, filters, collapseOverrides),
    [agendas, filters, collapseOverrides],
  );

  // 안 읽음·보는 중·선택 같은 자주 바뀌는 값은 배치와 따로 붙인다
  const nodes = useMemo<AgendaFlowNode[]>(
    () =>
      layout.nodes.map((n) => ({
        id: n.id,
        type: "agenda",
        position: { x: n.x, y: n.y },
        ...NODE_SIZE,
        measured: NODE_SIZE,
        handles: NODE_HANDLES,
        draggable: false,
        selectable: false,
        data: {
          agenda: agendas[n.id],
          height: n.height,
          dimmed: n.dimmed,
          selected: n.id === selectedId,
          unread: unread[n.id] ?? 0,
          viewers: (viewers[n.id] ?? []).map((uid) => ({
            uid,
            slot: members[uid]?.slot,
            name: members[uid]?.nickname ?? "",
          })),
          childCount: n.childCount,
          hiddenCount: n.hiddenCount,
          collapsed: n.collapsed,
          onToggle,
        },
      })),
    [layout, agendas, selectedId, unread, viewers, members, onToggle],
  );

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        selectable: false,
        style: { stroke: "#4a4a55", strokeWidth: 1.5, opacity: e.dimmed ? 0.35 : 1 },
      })),
    [layout],
  );

  if (Object.keys(agendas).length === 0) {
    return (
      <EmptyState>
        <p>아직 안건이 없어요.</p>
        <button
          type="button"
          onClick={() => openModal({ kind: "agenda" })}
          className="mt-2 text-xs text-sky-300 hover:underline"
        >
          + 첫 안건 만들기
        </button>
      </EmptyState>
    );
  }
  if (layout.matchCount === 0) {
    return (
      <EmptyState>
        <p>조건에 맞는 안건이 없어요.</p>
        <button
          type="button"
          onClick={() => useRoom.setState({ filters: defaultFilters() })}
          className="mt-2 text-xs text-sky-300 hover:underline"
        >
          필터 초기화
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="mindmap h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.6}
        zoomOnDoubleClick={false}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#26262d" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-muted">{children}</div>;
}
