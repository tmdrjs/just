const timeFmt = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const shortDateFmt = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" });

export function formatTime(iso: string) {
  return timeFmt.format(toMs(iso));
}

export function formatDate(iso: string) {
  return dateFmt.format(toMs(iso));
}

export function dayKey(iso: string) {
  const d = new Date(toMs(iso));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 안건 목록용: 오늘이면 시각, 아니면 날짜 */
export function formatRelative(iso: string) {
  const d = new Date(toMs(iso));
  if (dayKey(iso) === dayKey(new Date().toISOString())) return timeFmt.format(d);
  return shortDateFmt.format(d);
}

/**
 * Postgres / Realtime 타임스탬프를 ms로 변환.
 * "2026-10-02 01:23:45.123456+00" 같은 형식도 브라우저마다 같게 해석되도록 정규화한다.
 */
export function toMs(ts: string) {
  const direct = Date.parse(ts);
  if (!Number.isNaN(direct) && ts.includes("T")) return direct;
  const normalized = ts
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? direct : parsed;
}
