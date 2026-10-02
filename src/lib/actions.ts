"use client";

import { PAGE_SIZE } from "./constants";
import { canPlay, OMOK_ERRORS, type OmokGame } from "./omok";
import { isMyTurn, YACHT_ERRORS, type YachtCategory, type YachtGame } from "./yacht";
import { toMs } from "./format";
import { emptyThread, showToast, useRoom, type Thread } from "./store";
import { getSupabase } from "./supabase";
import type { Agenda, AgendaStatus, ChatMessage, Member, Message, RpcResult } from "./types";

const sb = () => getSupabase();
const get = () => useRoom.getState();
const set = useRoom.setState;

// ---------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------

function compareMessages(a: Message, b: Message) {
  return toMs(a.created_at) - toMs(b.created_at) || a.id.localeCompare(b.id);
}

export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // http(비보안) 환경 대비
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function isPermissionError(error: { code?: string } | null) {
  return error?.code === "42501" || error?.code === "PGRST301";
}

/** 쓰기 실패 시: 권한 문제면 멤버 자격을 다시 확인 */
function handleWriteError(error: { code?: string; message?: string }, fallback: string) {
  if (isPermissionError(error)) void fetchMembers();
  showToast(fallback);
}

function updateThread(agendaId: string, fn: (t: Thread) => Thread) {
  const t = get().threads[agendaId];
  if (!t) return;
  set({ threads: { ...get().threads, [agendaId]: fn(t) } });
}

/**
 * 서버에서 받은 메시지(조회 결과 / Realtime / 쓰기 응답)를 반영.
 * 해당 안건 스레드가 열려 있을 때만 목록에 넣고, 핀 목록도 함께 맞춘다.
 */
export function upsertMessages(rows: Message[]) {
  const threads = { ...get().threads };
  let changed = false;
  for (const row of rows) {
    const t = threads[row.agenda_id];
    if (!t) continue;
    let list = t.list;
    const idx = list.findIndex((m) => m.id === row.id);
    if (idx >= 0) {
      list = list.slice();
      list[idx] = row;
    } else {
      // 아직 불러오지 않은 더 오래된 구간의 메시지는 나중에 페이지로 불러온다
      const oldest = list.find((m) => !m.localStatus);
      if (t.hasMore && oldest && compareMessages(row, oldest) < 0) {
        // skip
      } else {
        list = [...list, row];
      }
    }
    list = list.slice().sort(compareMessages);

    let pinned = t.pinned.filter((m) => m.id !== row.id);
    if (row.is_pinned && !row.deleted_at) pinned = [...pinned, row].sort(compareMessages);

    threads[row.agenda_id] = { ...t, list, pinned };
    changed = true;
  }
  if (changed) set({ threads });
}

function serverMessages(t: Thread) {
  return t.list.filter((m) => !m.localStatus);
}

// ---------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------

export async function fetchMembers() {
  const { data, error } = await sb().from("members").select("*").order("slot");
  if (error) return;
  const members = Object.fromEntries((data as Member[]).map((m) => [m.user_id, m]));
  set({ members, membersLoaded: true, kicked: !members[get().userId] });
}

/** 마이그레이션 전 DB나 Realtime 행에서 빠진 필드를 채운다 */
function normalizeAgenda(row: Agenda): Agenda {
  return { ...row, parent_id: row.parent_id ?? null };
}

export async function fetchAgendas() {
  const { data, error } = await sb()
    .from("agendas")
    .select("*")
    .is("deleted_at", null)
    .order("last_activity_at", { ascending: false });
  if (error) return;
  const agendas = Object.fromEntries((data as Agenda[]).map((a) => [a.id, normalizeAgenda(a)]));
  const { selectedId } = get();
  set({
    agendas,
    agendasLoaded: true,
    selectedId: selectedId && agendas[selectedId] ? selectedId : null,
  });
}

export async function fetchUnread() {
  const { data, error } = await sb().rpc("get_unread_counts");
  if (error) return;
  const unread: Record<string, number> = {};
  for (const r of data as { agenda_id: string; unread_count: number }[]) {
    unread[r.agenda_id] = r.unread_count;
  }
  const { selectedId } = get();
  if (selectedId && isViewing(selectedId)) {
    unread[selectedId] = 0;
    markRead(selectedId);
  }
  set({ unread });
}

async function fetchPinned(agendaId: string) {
  const { data } = await sb()
    .from("messages")
    .select("*")
    .eq("agenda_id", agendaId)
    .eq("is_pinned", true)
    .is("deleted_at", null)
    .order("created_at");
  return (data as Message[] | null) ?? [];
}

/** 안건의 최근 메시지 한 페이지 + 핀 목록을 불러온다 */
export async function loadThread(agendaId: string) {
  if (!get().threads[agendaId]) {
    // 불러오는 동안 들어오는 Realtime 메시지도 담을 수 있게 먼저 자리를 만든다
    set({ threads: { ...get().threads, [agendaId]: emptyThread() } });
  }
  const [latest, pinned] = await Promise.all([
    sb()
      .from("messages")
      .select("*")
      .eq("agenda_id", agendaId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
    fetchPinned(agendaId),
    fetchGames(agendaId),
  ]);
  if (latest.error) {
    updateThread(agendaId, (t) => ({ ...t, loading: false }));
    showToast("메시지를 불러오지 못했어요.");
    return;
  }
  const rows = (latest.data as Message[]).reverse();
  updateThread(agendaId, (t) => {
    const ids = new Set(rows.map((r) => r.id));
    const extra = t.list.filter((m) => !ids.has(m.id));
    return {
      ...t,
      list: [...rows, ...extra].sort(compareMessages),
      pinned,
      hasMore: rows.length === PAGE_SIZE,
      loading: false,
    };
  });
}

export async function loadOlder(agendaId: string) {
  const t = get().threads[agendaId];
  if (!t || !t.hasMore || t.loadingOlder) return;
  const oldest = serverMessages(t)[0];
  if (!oldest) return;
  updateThread(agendaId, (x) => ({ ...x, loadingOlder: true }));
  const { data, error } = await sb()
    .from("messages")
    .select("*")
    .eq("agenda_id", agendaId)
    .lt("created_at", oldest.created_at)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) {
    updateThread(agendaId, (x) => ({ ...x, loadingOlder: false }));
    showToast("이전 메시지를 불러오지 못했어요.");
    return;
  }
  const rows = (data as Message[]).reverse();
  updateThread(agendaId, (x) => {
    const ids = new Set(x.list.map((m) => m.id));
    return {
      ...x,
      list: [...rows.filter((r) => !ids.has(r.id)), ...x.list].sort(compareMessages),
      hasMore: rows.length === PAGE_SIZE,
      loadingOlder: false,
    };
  });
}

/** 핀 클릭 시 원본이 아직 안 불러와졌으면 그 시점까지 불러온다 */
export async function loadUntil(agendaId: string, createdAt: string) {
  const t = get().threads[agendaId];
  if (!t) return;
  const oldest = serverMessages(t)[0];
  if (!oldest || !t.hasMore || toMs(createdAt) >= toMs(oldest.created_at)) return;
  const { data, error } = await sb()
    .from("messages")
    .select("*")
    .eq("agenda_id", agendaId)
    .gte("created_at", createdAt)
    .lt("created_at", oldest.created_at)
    .order("created_at");
  if (error) return;
  const rows = data as Message[];
  updateThread(agendaId, (x) => {
    const ids = new Set(x.list.map((m) => m.id));
    return { ...x, list: [...rows.filter((r) => !ids.has(r.id)), ...x.list].sort(compareMessages) };
  });
}

/** 연결이 끊겼다가 돌아왔을 때 놓친 변경을 다시 맞춘다 */
export async function resync() {
  await Promise.all([fetchMembers(), fetchAgendas(), fetchUnread()]);
  const { selectedId, threads } = get();
  // 보고 있지 않은 안건은 다음에 열 때 새로 불러온다
  const kept: Record<string, Thread> = {};
  if (selectedId && threads[selectedId]) kept[selectedId] = threads[selectedId];
  set({ threads: kept });
  if (!selectedId) return;

  const t = kept[selectedId];
  const oldest = t ? serverMessages(t)[0] : undefined;
  if (!t || !oldest) {
    await loadThread(selectedId);
    return;
  }
  // 이미 불러온 구간 전체를 다시 받아 수정/삭제/핀 변경까지 반영
  void fetchGames(selectedId);
  const [{ data, error }, pinned] = await Promise.all([
    sb()
      .from("messages")
      .select("*")
      .eq("agenda_id", selectedId)
      .gte("created_at", oldest.created_at)
      .order("created_at")
      .limit(1000),
    fetchPinned(selectedId),
  ]);
  if (error) return;
  const rows = data as Message[];
  updateThread(selectedId, (x) => {
    const ids = new Set(rows.map((r) => r.id));
    const local = x.list.filter((m) => m.localStatus && !ids.has(m.id));
    return { ...x, list: [...rows, ...local].sort(compareMessages), pinned };
  });
}

// ---------------------------------------------------------------------
// 선택 / 읽음
// ---------------------------------------------------------------------

function isViewing(agendaId: string) {
  return (
    get().selectedId === agendaId &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible"
  );
}

const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function markRead(agendaId: string) {
  clearTimeout(readTimers.get(agendaId));
  readTimers.set(
    agendaId,
    setTimeout(() => {
      readTimers.delete(agendaId);
      // Postgrest 쿼리는 then()이 호출돼야 실제로 전송된다
      void sb()
        .rpc("mark_agenda_read", { p_agenda_id: agendaId })
        .then(() => undefined);
    }, 600),
  );
}

export function selectAgenda(agendaId: string | null) {
  set({ selectedId: agendaId, panel: agendaId ? "chat" : "list" });
  if (!agendaId) return;
  set({ unread: { ...get().unread, [agendaId]: 0 } });
  markRead(agendaId);
  const t = get().threads[agendaId];
  if (!t) void loadThread(agendaId);
}

/** 탭으로 돌아왔을 때 보고 있는 안건을 읽음 처리 */
export function onVisible() {
  const { selectedId } = get();
  if (selectedId && isViewing(selectedId)) {
    set({ unread: { ...get().unread, [selectedId]: 0 } });
    markRead(selectedId);
  }
}

// ---------------------------------------------------------------------
// Realtime 이벤트 반영
// ---------------------------------------------------------------------

export function applyMessageInsert(row: Message) {
  const exists = get().threads[row.agenda_id]?.list.some((m) => m.id === row.id);
  upsertMessages([row]);
  if (row.sender_id && get().typing[row.sender_id]) {
    const typing = { ...get().typing };
    delete typing[row.sender_id];
    set({ typing });
  }
  if (exists || row.sender_id === get().userId || row.deleted_at) return;
  if (isViewing(row.agenda_id)) {
    markRead(row.agenda_id);
  } else {
    const unread = get().unread;
    set({ unread: { ...unread, [row.agenda_id]: (unread[row.agenda_id] ?? 0) + 1 } });
  }
}

export function applyMessageUpdate(row: Message) {
  upsertMessages([row]);
}

export function applyAgendaChange(row: Agenda) {
  const agendas = { ...get().agendas };
  if (row.deleted_at) {
    delete agendas[row.id];
    const patch: Partial<ReturnType<typeof get>> = { agendas };
    if (get().selectedId === row.id) {
      patch.selectedId = null;
      patch.panel = "list";
      showToast(`"${row.title}" 안건이 삭제됐어요.`);
    }
    set(patch);
    return;
  }
  agendas[row.id] = normalizeAgenda(row);
  set({ agendas });
}

// ---------------------------------------------------------------------
// 메시지 쓰기
// ---------------------------------------------------------------------

async function insertMessage(msg: ChatMessage) {
  const { data, error } = await sb()
    .from("messages")
    .insert({ id: msg.id, agenda_id: msg.agenda_id, content: msg.content })
    .select()
    .single();
  if (!error) {
    upsertMessages([data as Message]);
    return;
  }
  if (error.code === "23505") {
    // 재시도했는데 사실 이미 저장돼 있던 경우
    const { data: existing } = await sb().from("messages").select("*").eq("id", msg.id).single();
    if (existing) {
      upsertMessages([existing as Message]);
      return;
    }
  }
  if (isPermissionError(error)) void fetchMembers();
  updateThread(msg.agenda_id, (t) => ({
    ...t,
    list: t.list.map((m) => (m.id === msg.id ? { ...m, localStatus: "failed" } : m)),
  }));
}

export function sendMessage(agendaId: string, content: string) {
  const { userId, members } = get();
  const msg: ChatMessage = {
    id: newId(),
    agenda_id: agendaId,
    sender_id: userId,
    sender_nickname: members[userId]?.nickname ?? "",
    content,
    is_pinned: false,
    edited_at: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    localStatus: "sending",
  };
  updateThread(agendaId, (t) => ({ ...t, list: [...t.list, msg] }));
  void insertMessage(msg);
}

export function retryMessage(agendaId: string, id: string) {
  const msg = get().threads[agendaId]?.list.find((m) => m.id === id);
  if (!msg) return;
  const retry = { ...msg, localStatus: "sending" as const, created_at: new Date().toISOString() };
  updateThread(agendaId, (t) => ({
    ...t,
    list: t.list.map((m) => (m.id === id ? retry : m)).sort(compareMessages),
  }));
  void insertMessage(retry);
}

export function discardMessage(agendaId: string, id: string) {
  updateThread(agendaId, (t) => ({ ...t, list: t.list.filter((m) => m.id !== id) }));
}

export async function editMessage(id: string, content: string) {
  const { data, error } = await sb().from("messages").update({ content }).eq("id", id).select().single();
  if (error) return handleWriteError(error, "메시지를 수정하지 못했어요.");
  upsertMessages([data as Message]);
}

export async function deleteMessage(id: string) {
  const { data, error } = await sb()
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return handleWriteError(error, "메시지를 삭제하지 못했어요.");
  upsertMessages([data as Message]);
}

export async function setPinned(message: Message, pinned: boolean) {
  const { data, error } = await sb().rpc("set_message_pinned", {
    p_message_id: message.id,
    p_pinned: pinned,
  });
  const result = data as RpcResult | null;
  if (error || !result?.ok) return handleWriteError(error ?? {}, "핀을 바꾸지 못했어요.");
  upsertMessages([{ ...message, is_pinned: pinned }]);
}

// ---------------------------------------------------------------------
// 안건 쓰기
// ---------------------------------------------------------------------

export interface AgendaInput {
  title: string;
  description: string | null;
  parent_id: string | null;
}

export async function createAgenda(input: AgendaInput) {
  const { data, error } = await sb().from("agendas").insert(input).select().single();
  if (error) {
    handleWriteError(error, agendaErrorMessage(error.message, "안건을 만들지 못했어요."));
    return null;
  }
  applyAgendaChange(data as Agenda);
  return normalizeAgenda(data as Agenda);
}

export async function updateAgenda(
  id: string,
  patch: Partial<Pick<Agenda, "title" | "description" | "conclusion" | "parent_id">> & {
    status?: AgendaStatus;
  },
) {
  const { data, error } = await sb().from("agendas").update(patch).eq("id", id).select().single();
  if (error) {
    handleWriteError(error, agendaErrorMessage(error.message));
    return false;
  }
  applyAgendaChange(data as Agenda);
  return true;
}

/** DB 제약 위반을 이유가 보이는 문구로 바꾼다 */
function agendaErrorMessage(message: string, fallback = "안건을 저장하지 못했어요.") {
  if (message.includes("AGENDA_PARENT_CYCLE")) return "자신의 하위 안건을 상위 안건으로 고를 수 없어요.";
  if (message.includes("AGENDA_PARENT_SELF")) return "자기 자신을 상위 안건으로 고를 수 없어요.";
  if (message.includes("AGENDA_PARENT_INVALID")) return "고른 상위 안건이 삭제됐어요. 다시 골라 주세요.";
  if (message.includes("parent_id") && /column|schema cache/.test(message)) {
    return "DB에 상위 안건 컬럼이 아직 없어요. 마이그레이션(20261002040000_agenda_tree.sql)을 실행했는지 확인해 주세요.";
  }
  if (message.includes("agendas_status_check")) {
    return "DB가 아직 새 상태를 몰라요. 상태 확장 마이그레이션(20261002020000_agenda_stages.sql)을 실행했는지 확인해 주세요.";
  }
  if (message.includes("conclusion")) return "확정 이후 단계는 결론이 꼭 있어야 해요.";
  return fallback;
}

export async function deleteAgenda(id: string) {
  const { data, error } = await sb()
    .from("agendas")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    handleWriteError(error, "안건을 삭제하지 못했어요.");
    return false;
  }
  const row = data as Agenda;
  const agendas = { ...get().agendas };
  delete agendas[row.id];
  set({ agendas, selectedId: get().selectedId === id ? null : get().selectedId, panel: "list" });
  return true;
}

// ---------------------------------------------------------------------
// 오목
// ---------------------------------------------------------------------

function setGames(rows: OmokGame[]) {
  if (!rows.length) return;
  const games = { ...get().games };
  for (const g of rows) games[g.message_id] = g;
  set({ games });
}

export async function fetchGames(agendaId: string) {
  const [omok, yacht] = await Promise.all([
    sb().from("omok_games").select("*").eq("agenda_id", agendaId),
    sb().from("yacht_games").select("*").eq("agenda_id", agendaId),
  ]);
  setGames((omok.data as OmokGame[] | null) ?? []);
  setYachts((yacht.data as YachtGame[] | null) ?? []);
}

export async function fetchGame(messageId: string) {
  const { data } = await sb().from("omok_games").select("*").eq("message_id", messageId).maybeSingle();
  if (data) setGames([data as OmokGame]);
}

/** Realtime 으로 받은 대국 변경. 내 차례가 됐는데 그 채팅을 안 보고 있으면 알려 준다 */
export function applyGameChange(row: OmokGame) {
  const prev = get().games[row.message_id];
  setGames([row]);
  if (!prev || row.moves.length <= prev.moves.length) return;
  const { userId, agendas } = get();
  if (isViewing(row.agenda_id)) return;
  const where = agendas[row.agenda_id]?.title ?? "";
  if (row.status === "playing" && canPlay(row, userId) && (row.black_id === userId || row.white_id === userId)) {
    showToast(`🎮 오목: 내 차례예요 · ‘${where}’`);
  } else if (row.status === "finished" && (row.black_id === userId || row.white_id === userId)) {
    showToast(`🎮 오목 끝: ${row.winner === "b" ? row.black_nickname : row.white_nickname} 승리 · ‘${where}’`);
  }
}

async function omokRpc(fn: "omok_play" | "omok_resign", args: Record<string, unknown>) {
  const { data, error } = await sb().rpc(fn, args);
  const result = data as ({ ok: true; game: OmokGame } | { ok: false; error: string }) | null;
  if (error || !result) {
    showToast("오목 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return false;
  }
  if (!result.ok) {
    showToast(OMOK_ERRORS[result.error] ?? "둘 수 없는 자리예요.");
    return false;
  }
  setGames([result.game]);
  return true;
}

export const playOmok = (messageId: string, cell: number) =>
  omokRpc("omok_play", { p_message_id: messageId, p_cell: cell });

export const resignOmok = (messageId: string) => omokRpc("omok_resign", { p_message_id: messageId });

// ---------------------------------------------------------------------
// 야추
// ---------------------------------------------------------------------

function setYachts(rows: YachtGame[]) {
  if (!rows.length) return;
  const yachts = { ...get().yachts };
  for (const g of rows) yachts[g.message_id] = g;
  set({ yachts });
}

export async function fetchYacht(messageId: string) {
  const { data } = await sb().from("yacht_games").select("*").eq("message_id", messageId).maybeSingle();
  if (data) setYachts([data as YachtGame]);
}

/** Realtime 으로 받은 야추 변경. 내 차례가 됐는데 그 채팅을 안 보고 있으면 알려 준다 */
export function applyYachtChange(row: YachtGame) {
  const prev = get().yachts[row.message_id];
  setYachts([row]);
  const { userId, agendas } = get();
  if (!prev || isViewing(row.agenda_id)) return;
  const where = agendas[row.agenda_id]?.title ?? "";
  const becameMyTurn = isMyTurn(row, userId) && !(isMyTurn(prev, userId) && prev.round === row.round);
  if (becameMyTurn) showToast(`🎲 야추: 내 차례예요 · ‘${where}’`);
  else if (prev.status === "lobby" && row.status === "playing" && row.player_count > 1) {
    showToast(`🎲 야추가 시작됐어요 · ‘${where}’`);
  }
}

type YachtRpc = "yacht_join" | "yacht_start" | "yacht_roll" | "yacht_hold" | "yacht_score" | "yacht_end";

async function yachtRpc(fn: YachtRpc, args: Record<string, unknown>) {
  const { data, error } = await sb().rpc(fn, args);
  const result = data as ({ ok: true; game: YachtGame } | { ok: false; error: string }) | null;
  if (error || !result) {
    showToast("야추 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return false;
  }
  if (!result.ok) {
    showToast(YACHT_ERRORS[result.error] ?? "지금은 할 수 없어요.");
    return false;
  }
  setYachts([result.game]);
  return true;
}

export const yachtJoin = (id: string) => yachtRpc("yacht_join", { p_message_id: id });
export const yachtStart = (id: string) => yachtRpc("yacht_start", { p_message_id: id });
export const yachtRoll = (id: string) => yachtRpc("yacht_roll", { p_message_id: id });
export const yachtHold = (id: string, index: number) => yachtRpc("yacht_hold", { p_message_id: id, p_index: index });
export const yachtScore = (id: string, category: YachtCategory) =>
  yachtRpc("yacht_score", { p_message_id: id, p_category: category });
export const yachtEnd = (id: string) => yachtRpc("yacht_end", { p_message_id: id });

// ---------------------------------------------------------------------
// 멤버
// ---------------------------------------------------------------------

export async function leaveRoom() {
  const { data, error } = await sb().rpc("leave_room");
  return !error && (data as RpcResult | null)?.ok === true;
}
