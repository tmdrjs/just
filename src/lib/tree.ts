import type { Agenda } from "./types";

/** parent_id → 자식 id 목록. 부모가 목록에 없으면(삭제됨 등) 최상위로 본다 */
export function buildChildren(agendas: Record<string, Agenda>) {
  const children: Record<string, string[]> = {};
  const roots: string[] = [];
  for (const a of Object.values(agendas)) {
    if (a.parent_id && agendas[a.parent_id]) (children[a.parent_id] ??= []).push(a.id);
    else roots.push(a.id);
  }
  return { children, roots };
}

/** 자신과 모든 하위 안건 id (상위 안건 선택에서 제외할 대상) */
export function selfAndDescendants(id: string, children: Record<string, string[]>) {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(children[cur] ?? []));
  }
  return out;
}

/** 루트부터 자신까지의 경로 (순환 방어 포함) */
export function ancestorsOf(id: string, agendas: Record<string, Agenda>) {
  const path: Agenda[] = [];
  const seen = new Set<string>();
  let cur = agendas[id]?.parent_id;
  while (cur && agendas[cur] && !seen.has(cur)) {
    seen.add(cur);
    path.unshift(agendas[cur]);
    cur = agendas[cur].parent_id;
  }
  return path;
}

/** 깊이 우선 순서로 펼친 트리 (형제는 만든 순서). 상위 안건 선택 목록에 쓴다 */
export function flattenTree(agendas: Record<string, Agenda>) {
  const { children, roots } = buildChildren(agendas);
  const byCreated = (a: string, b: string) => agendas[a].created_at.localeCompare(agendas[b].created_at);
  const out: { agenda: Agenda; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ agenda: agendas[id], depth });
    for (const c of [...(children[id] ?? [])].sort(byCreated)) walk(c, depth + 1);
  };
  for (const r of [...roots].sort(byCreated)) walk(r, 0);
  return out;
}
