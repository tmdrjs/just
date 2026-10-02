"use client";

import { create } from "zustand";
import type { Agenda, AgendaStatus, ChatMessage, Member, Message } from "./types";

export interface Thread {
  /** 오래된 것이 앞, 새 것이 뒤 */
  list: ChatMessage[];
  pinned: Message[];
  hasMore: boolean;
  loading: boolean;
  loadingOlder: boolean;
}

export interface PresenceInfo {
  agendaId: string | null;
  at: number;
}

export interface TypingInfo {
  agendaId: string;
  until: number;
}

export type Connection = "connecting" | "online" | "offline";

export type ModalState =
  | { kind: "agenda"; agendaId?: string }
  /** status: 이 상태로 바꾸면서 결론 입력 (없으면 결론만 수정) */
  | { kind: "conclusion"; agendaId: string; status?: AgendaStatus }
  | { kind: "deleteAgenda"; agendaId: string }
  | { kind: "deleteMessage"; message: Message }
  | { kind: "settings" }
  | null;
export type MobilePanel = "list" | "chat" | "info";

export interface RoomState {
  userId: string;
  members: Record<string, Member>;
  membersLoaded: boolean;
  agendas: Record<string, Agenda>;
  agendasLoaded: boolean;
  threads: Record<string, Thread>;
  unread: Record<string, number>;
  selectedId: string | null;
  presence: Record<string, PresenceInfo>;
  typing: Record<string, TypingInfo>;
  connection: Connection;
  /** 다른 기기에서 다시 연결했거나 자리가 사라져 더 이상 멤버가 아님 */
  kicked: boolean;
  panel: MobilePanel;
  modal: ModalState;
  toast: { id: number; text: string } | null;
}

export const initialRoomState = (userId: string): RoomState => ({
  userId,
  members: {},
  membersLoaded: false,
  agendas: {},
  agendasLoaded: false,
  threads: {},
  unread: {},
  selectedId: null,
  presence: {},
  typing: {},
  connection: "connecting",
  kicked: false,
  panel: "list",
  modal: null,
  toast: null,
});

export const useRoom = create<RoomState>(() => initialRoomState(""));

export const emptyThread = (): Thread => ({
  list: [],
  pinned: [],
  hasMore: false,
  loading: true,
  loadingOlder: false,
});

let toastSeq = 0;
export function showToast(text: string) {
  const id = ++toastSeq;
  useRoom.setState({ toast: { id, text } });
  setTimeout(() => {
    if (useRoom.getState().toast?.id === id) useRoom.setState({ toast: null });
  }, Math.max(3500, text.length * 70));
}

export const openModal = (modal: ModalState) => useRoom.setState({ modal });
export const closeModal = () => useRoom.setState({ modal: null });
