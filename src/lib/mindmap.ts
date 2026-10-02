import dagre from "@dagrejs/dagre";
import { isFiltering, matchesFilters } from "./filters";
import type { AgendaFilters } from "./store";
import { buildChildren } from "./tree";
import type { Agenda } from "./types";

export const NODE_W = 240;
/** 이 깊이(0부터) 이상인 노드는 처음에 접힌 상태 → 4단계보다 깊은 안건은 펼쳐야 보인다 */
export const AUTO_COLLAPSE_DEPTH = 3;

export const NODE_H = 70;

export interface MapNode {
  id: string;
  x: number;
  y: number;
  height: number;
  depth: number;
  /** 필터에 안 맞지만 맞는 하위 안건으로 가는 경로라서 흐리게 남긴 노드 */
  dimmed: boolean;
  childCount: number;
  /** 접혀서 안 보이는 하위 안건 수 */
  hiddenCount: number;
  collapsed: boolean;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  dimmed: boolean;
}

/**
 * 안건 트리 → 마인드맵 노드/엣지 (dagre 자동 배치, 왼쪽→오른쪽).
 * 최상위 안건이 여러 개면 가상 루트 없이 여러 트리를 나란히 배치한다.
 */
export function computeMindMap(
  agendas: Record<string, Agenda>,
  filters: AgendaFilters,
  collapseOverrides: Record<string, boolean>,
) {
  const { children, roots } = buildChildren(agendas);
  const byCreated = (a: string, b: string) => agendas[a].created_at.localeCompare(agendas[b].created_at);

  // 필터: 맞는 안건 + 그 상위 경로(흐리게)만 남긴다
  const filtering = isFiltering(filters);
  const matches = new Set<string>();
  const visible = new Set<string>();
  for (const a of Object.values(agendas)) {
    if (filtering && !matchesFilters(a, filters)) continue;
    matches.add(a.id);
    let cur: string | null = a.id;
    while (cur && agendas[cur] && !visible.has(cur)) {
      visible.add(cur);
      cur = agendas[cur].parent_id;
    }
  }

  const visibleKids = (id: string) => (children[id] ?? []).filter((k) => visible.has(k)).sort(byCreated);
  const countDescendants = (id: string): number =>
    visibleKids(id).reduce((sum, k) => sum + 1 + countDescendants(k), 0);

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number, parent: string | null) => {
    if (!visible.has(id) || seen.has(id)) return;
    seen.add(id);
    const kids = visibleKids(id);
    const collapsed = kids.length > 0 && (collapseOverrides[id] ?? depth >= AUTO_COLLAPSE_DEPTH);
    const dimmed = filtering && !matches.has(id);
    nodes.push({
      id,
      x: 0,
      y: 0,
      height: NODE_H,
      depth,
      dimmed,
      childCount: kids.length,
      hiddenCount: collapsed ? countDescendants(id) : 0,
      collapsed,
    });
    if (parent) edges.push({ id: `${parent}->${id}`, source: parent, target: id, dimmed });
    if (!collapsed) for (const k of kids) walk(k, depth + 1, id);
  };
  for (const r of roots.filter((id) => visible.has(id)).sort(byCreated)) walk(r, 0, null);

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 64, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const p = g.node(n.id);
    n.x = p.x - NODE_W / 2;
    n.y = p.y - n.height / 2;
  }

  return { nodes, edges, matchCount: matches.size };
}
