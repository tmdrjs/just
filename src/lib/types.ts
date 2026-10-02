export type AgendaStatus =
  | "discussing"
  | "decided"
  | "in_progress"
  | "in_studio"
  | "tested"
  | "on_hold";

export interface Member {
  user_id: string;
  nickname: string;
  slot: number;
  joined_at: string;
}

export interface Agenda {
  id: string;
  title: string;
  description: string | null;
  status: AgendaStatus;
  conclusion: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  deleted_at: string | null;
}

export interface Message {
  id: string;
  agenda_id: string;
  sender_id: string | null;
  sender_nickname: string;
  content: string;
  is_pinned: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

/** 낙관적 UI용: 아직 서버에 저장되지 않았거나 실패한 메시지 */
export interface ChatMessage extends Message {
  localStatus?: "sending" | "failed";
}

export type RpcResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
