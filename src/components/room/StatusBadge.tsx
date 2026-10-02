import { STATUS_LABEL } from "@/lib/constants";
import type { AgendaStatus } from "@/lib/types";

/** 상태별 색상 (배지 / 단계 표시 공용) */
export const STATUS_STYLE: Record<AgendaStatus, { badge: string; text: string; dot: string }> = {
  discussing: { badge: "bg-sky-400/10 text-sky-300 ring-sky-400/25", text: "text-sky-300", dot: "bg-sky-400" },
  decided: {
    badge: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  in_progress: {
    badge: "bg-violet-400/10 text-violet-300 ring-violet-400/25",
    text: "text-violet-300",
    dot: "bg-violet-400",
  },
  in_studio: {
    badge: "bg-orange-400/10 text-orange-300 ring-orange-400/25",
    text: "text-orange-300",
    dot: "bg-orange-400",
  },
  tested: { badge: "bg-lime-400/10 text-lime-300 ring-lime-400/25", text: "text-lime-300", dot: "bg-lime-400" },
  on_hold: { badge: "bg-zinc-400/10 text-zinc-400 ring-zinc-400/25", text: "text-zinc-300", dot: "bg-zinc-500" },
};

export function StatusBadge({ status, small }: { status: AgendaStatus; small?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full whitespace-nowrap ring-1 ring-inset ${STATUS_STYLE[status].badge} ${
        small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs"
      }`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
