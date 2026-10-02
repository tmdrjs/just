import type { AgendaStatus } from "./types";

export const NICKNAME_MAX = 12;
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 2000;
export const CONCLUSION_MAX = 200;
export const MESSAGE_MAX = 4000;
export const PAGE_SIZE = 100;
export const TYPING_TIMEOUT_MS = 3000;

/** 멤버 slot(1~3)별 고정 색상 */
export const MEMBER_COLORS: Record<number, string> = {
  1: "#fb7185",
  2: "#2dd4bf",
  3: "#fbbf24",
};
export const LEFT_MEMBER_COLOR = "#8b8b94";

export function memberColor(slot: number | undefined | null) {
  return (slot && MEMBER_COLORS[slot]) || LEFT_MEMBER_COLOR;
}

export const STATUS_LABEL: Record<AgendaStatus, string> = {
  discussing: "논의 중",
  decided: "확정",
  in_progress: "제작 중",
  in_studio: "스튜디오 반영됨",
  tested: "테스트 완료",
  on_hold: "보류",
};

/** 토의 → 구현 → 테스트 진행 단계 (보류는 단계 밖에서 언제든 가능) */
export const STAGES: AgendaStatus[] = ["discussing", "decided", "in_progress", "in_studio", "tested"];

/** 필터 등에 쓰는 전체 상태 순서 */
export const STATUS_ORDER: AgendaStatus[] = [...STAGES, "on_hold"];

/** 확정 이후 단계: 결론이 반드시 있어야 한다 (DB 제약 agendas_conclusion_required 와 같음) */
export const CONCLUSION_REQUIRED = new Set<AgendaStatus>(["decided", "in_progress", "in_studio", "tested"]);

/** 결론을 "현재 결론"으로 보여줄 상태 (보류도 결론이 있으면 표시) */
export function showsConclusion(status: AgendaStatus, conclusion: string | null) {
  return Boolean(conclusion) && (CONCLUSION_REQUIRED.has(status) || status === "on_hold");
}

export const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CODE: "초대 코드가 올바르지 않아요.",
  TOO_MANY_ATTEMPTS: "시도가 너무 많아요. 10분 뒤에 다시 시도해 주세요.",
  ROOM_FULL: "자리가 가득 찼어요.",
  NICKNAME_TAKEN: "이미 사용 중인 닉네임이에요.",
  INVALID_NICKNAME: `닉네임은 공백을 제외하고 1~${NICKNAME_MAX}자로 입력해 주세요.`,
  MEMBER_NOT_FOUND: "그 닉네임의 멤버가 없어요.",
  ALREADY_MEMBER: "이미 다른 닉네임으로 들어와 있어요. 방을 나간 뒤 다시 시도해 주세요.",
  ROOM_NOT_CONFIGURED: "아직 초대 코드가 등록되지 않았어요. 방 관리자에게 알려 주세요.",
  NOT_AUTHENTICATED: "세션이 만료됐어요. 새로고침해 주세요.",
};

export function errorMessage(code: string | undefined) {
  return (code && ERROR_MESSAGES[code]) || "알 수 없는 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
}
