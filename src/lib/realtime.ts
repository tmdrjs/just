"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { TYPING_TIMEOUT_MS } from "./constants";
import {
  applyAgendaChange,
  applyMessageInsert,
  applyMessageUpdate,
  fetchMembers,
  resync,
} from "./actions";
import { useRoom, type PresenceInfo } from "./store";
import { getSupabase } from "./supabase";
import type { Agenda, Message } from "./types";

interface PresenceMeta {
  agenda_id: string | null;
  at: number;
}

interface TypingPayload {
  user_id: string;
  agenda_id: string;
}

let live: RealtimeChannel | null = null;
let lastTypingSentAt = 0;
let lastTypingAgenda: string | null = null;

/** 입력 중 알림 (1.5초에 한 번만 보낸다. 받는 쪽은 3초 동안 표시) */
export function sendTyping(agendaId: string) {
  const now = Date.now();
  if (agendaId === lastTypingAgenda && now - lastTypingSentAt < 1500) return;
  lastTypingSentAt = now;
  lastTypingAgenda = agendaId;
  void live?.send({
    type: "broadcast",
    event: "typing",
    payload: { user_id: useRoom.getState().userId, agenda_id: agendaId } satisfies TypingPayload,
  });
}

export function sendTypingStop(agendaId: string) {
  if (!lastTypingAgenda) return;
  lastTypingSentAt = 0;
  lastTypingAgenda = null;
  void live?.send({
    type: "broadcast",
    event: "typing_stop",
    payload: { user_id: useRoom.getState().userId, agenda_id: agendaId } satisfies TypingPayload,
  });
}

function trackPresence() {
  if (!live) return;
  void live.track({ agenda_id: useRoom.getState().selectedId, at: Date.now() } satisfies PresenceMeta);
}

function syncPresence(channel: RealtimeChannel) {
  const state = channel.presenceState<PresenceMeta>();
  const presence: Record<string, PresenceInfo> = {};
  // presence 키가 auth.uid() 이므로 탭을 여러 개 열어도 한 사람으로 묶인다
  for (const [userId, metas] of Object.entries(state)) {
    if (!metas.length) continue;
    const latest = metas.reduce((a, b) => (b.at > a.at ? b : a));
    presence[userId] = { agendaId: latest.agenda_id, at: latest.at };
  }
  const typing = { ...useRoom.getState().typing };
  for (const id of Object.keys(typing)) if (!presence[id]) delete typing[id];
  useRoom.setState({ presence, typing });
}

// supabase-js는 같은 topic의 채널 객체를 재사용하므로, 이전 연결이 완전히 정리된 뒤에 새로 연결한다
let previousTeardown: Promise<unknown> = Promise.resolve();

/**
 * Realtime 연결:
 *  - room:db   → Postgres Changes (agendas / messages / members)
 *  - room:live → Presence(접속·보고 있는 안건) + Broadcast(입력 중)
 * 둘 다 private 채널이라 멤버만 구독할 수 있다.
 */
export function connectRealtime(userId: string) {
  let stopped = false;
  let stop: (() => Promise<unknown>) | null = null;
  void previousTeardown.then(() => {
    if (!stopped) stop = startRealtime(userId);
  });
  return () => {
    stopped = true;
    if (stop) previousTeardown = stop();
  };
}

function startRealtime(userId: string) {
  const supabase = getSupabase();
  let dbReady = false;
  let liveReady = false;
  let everOnline = false;
  let disposed = false;

  const updateConnection = () => {
    if (disposed) return;
    const online = dbReady && liveReady && navigator.onLine;
    if (online) everOnline = true;
    useRoom.setState({ connection: online ? "online" : everOnline ? "offline" : "connecting" });
  };

  const db = supabase
    .channel("room:db", { config: { private: true } })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (p: RealtimePostgresChangesPayload<Message>) => applyMessageInsert(p.new as Message),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      (p: RealtimePostgresChangesPayload<Message>) => applyMessageUpdate(p.new as Message),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agendas" },
      (p: RealtimePostgresChangesPayload<Agenda>) => {
        if (p.eventType !== "DELETE") applyAgendaChange(p.new as Agenda);
      },
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => {
      void fetchMembers();
    })
    .subscribe((status) => {
      const wasReady = dbReady;
      dbReady = status === "SUBSCRIBED";
      updateConnection();
      // 처음 연결될 때와 다시 연결될 때 모두 놓친 변경을 맞춘다
      if (dbReady && !wasReady) void resync();
      if (status === "CHANNEL_ERROR") void fetchMembers();
    });

  const channel = supabase
    .channel("room:live", {
      config: { private: true, presence: { key: userId }, broadcast: { self: false } },
    })
    .on("presence", { event: "sync" }, () => syncPresence(channel))
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as TypingPayload;
      if (!p?.user_id || p.user_id === userId) return;
      useRoom.setState({
        typing: {
          ...useRoom.getState().typing,
          [p.user_id]: { agendaId: p.agenda_id, until: Date.now() + TYPING_TIMEOUT_MS },
        },
      });
    })
    .on("broadcast", { event: "typing_stop" }, ({ payload }) => {
      const p = payload as TypingPayload;
      const typing = { ...useRoom.getState().typing };
      if (!p?.user_id || !typing[p.user_id]) return;
      delete typing[p.user_id];
      useRoom.setState({ typing });
    })
    .subscribe((status) => {
      liveReady = status === "SUBSCRIBED";
      updateConnection();
      if (liveReady) trackPresence();
    });
  live = channel;

  // 보고 있는 안건이 바뀌면 presence 갱신
  const unsubscribeStore = useRoom.subscribe((s, prev) => {
    if (s.selectedId !== prev.selectedId && liveReady) trackPresence();
  });

  // 3초 지난 "입력 중" 정리
  const typingTimer = setInterval(() => {
    const typing = useRoom.getState().typing;
    const now = Date.now();
    const expired = Object.entries(typing).filter(([, t]) => t.until <= now);
    if (!expired.length) return;
    const next = { ...typing };
    for (const [id] of expired) delete next[id];
    useRoom.setState({ typing: next });
  }, 500);

  // 처음 연결이 10초 넘게 안 되면 "연결 끊김"으로 표시
  const firstConnectTimer = setTimeout(() => {
    if (!everOnline) {
      everOnline = true;
      updateConnection();
    }
  }, 10_000);

  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);

  return () => {
    disposed = true;
    clearInterval(typingTimer);
    clearTimeout(firstConnectTimer);
    unsubscribeStore();
    window.removeEventListener("online", updateConnection);
    window.removeEventListener("offline", updateConnection);
    if (live === channel) live = null;
    return Promise.all([supabase.removeChannel(db), supabase.removeChannel(channel)]);
  };
}
