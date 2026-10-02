"use client";

import { useMemo } from "react";
import { selectAgenda, updateAgenda } from "@/lib/actions";
import { CONCLUSION_REQUIRED, memberColor, showsConclusion, STAGES, STATUS_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { ancestorsOf } from "@/lib/tree";
import { openModal, useRoom } from "@/lib/store";
import type { Agenda, AgendaStatus } from "@/lib/types";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { STATUS_STYLE, StatusBadge } from "./StatusBadge";

export function DetailPanel() {
  const agenda = useRoom((s) => (s.selectedId ? s.agendas[s.selectedId] : undefined));

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 text-sm font-semibold text-sub">안건 정보</h2>
        <IconButton label="닫기" onClick={() => useRoom.setState({ panel: "chat" })}>
          <Icon name="close" className="size-5" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {agenda ? (
          <AgendaDetail agenda={agenda} />
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted">선택한 안건이 없어요.</p>
        )}
        <OnlineMembers />
      </div>
      {/* 안건 삭제는 다른 동작과 떨어진 맨 아래에 따로 둔다 */}
      {agenda && (
        <footer className="border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            variant="danger"
            className="w-full text-xs"
            onClick={() => openModal({ kind: "deleteAgenda", agendaId: agenda.id })}
          >
            <Icon name="trash" className="size-3.5" /> 안건 삭제
          </Button>
        </footer>
      )}
    </>
  );
}

function AgendaDetail({ agenda }: { agenda: Agenda }) {
  const creator = useRoom((s) => (agenda.created_by ? s.members[agenda.created_by] : undefined));

  const changeStatus = (status: AgendaStatus) => {
    if (status === agenda.status) return;
    // 확정은 결론을 항상 다시 확인하고, 그 이후 단계는 결론이 없을 때만 먼저 입력받는다
    if (status === "decided" || (CONCLUSION_REQUIRED.has(status) && !agenda.conclusion)) {
      openModal({ kind: "conclusion", agendaId: agenda.id, status });
      return;
    }
    void updateAgenda(agenda.id, { status });
  };
  const stageIndex = STAGES.indexOf(agenda.status);

  return (
    <div className="flex flex-col gap-5 border-b border-line px-4 py-4">
      <div>
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-base font-semibold break-words">{agenda.title}</h3>
          <IconButton label="안건 수정" onClick={() => openModal({ kind: "agenda", agendaId: agenda.id })}>
            <Icon name="edit" />
          </IconButton>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          {creator ? (
            <>
              <span style={{ color: memberColor(creator.slot) }}>{creator.nickname}</span> 님이{" "}
            </>
          ) : null}
          {formatDate(agenda.created_at)}에 만듦
        </p>
      </div>

      <AgendaHierarchy agenda={agenda} />

      <section>
        <SectionTitle>진행 단계</SectionTitle>
        {agenda.status === "on_hold" && (
          <p className="mb-2 rounded-md bg-zinc-400/10 px-2.5 py-1.5 text-xs text-zinc-300">
            ⏸ 보류 중이에요. 아래에서 단계를 고르면 다시 진행돼요.
          </p>
        )}
        <ol role="radiogroup" aria-label="진행 단계">
          {STAGES.map((s, i) => {
            const current = agenda.status === s;
            const passed = stageIndex > i;
            return (
              <li key={s} className="relative">
                {i < STAGES.length - 1 && (
                  <span
                    aria-hidden
                    className={`absolute top-[27px] -bottom-[9px] left-[14.5px] w-px ${passed ? "bg-zinc-500" : "bg-line"}`}
                  />
                )}
                <button
                  type="button"
                  role="radio"
                  aria-checked={current}
                  onClick={() => changeStatus(s)}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors ${
                    current ? "bg-elev" : "hover:bg-hover/60"
                  }`}
                >
                  <span
                    className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border ${
                      current
                        ? `${STATUS_STYLE[s].dot} border-transparent`
                        : passed
                          ? "border-transparent bg-zinc-500"
                          : "border-line bg-bg"
                    }`}
                  >
                    {passed && <Icon name="check" className="size-3 text-bg" />}
                  </span>
                  <span className={current ? `font-medium ${STATUS_STYLE[s].text}` : passed ? "text-sub" : "text-muted"}>
                    {STATUS_LABEL[s]}
                  </span>
                  {current && <span className="ml-auto text-[10px] text-muted">현재</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={() => changeStatus("on_hold")}
          disabled={agenda.status === "on_hold"}
          className="mt-2 w-full rounded-lg border border-line px-3 py-1.5 text-xs text-sub transition-colors hover:bg-hover disabled:border-zinc-500/40 disabled:bg-zinc-400/10 disabled:text-zinc-300"
        >
          {agenda.status === "on_hold" ? "⏸ 보류 중" : "⏸ 보류하기"}
        </button>
      </section>

      <section>
        <SectionTitle>결론</SectionTitle>
        {showsConclusion(agenda.status, agenda.conclusion) ? (
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3">
            <p className="text-sm leading-relaxed break-words text-emerald-200">{agenda.conclusion}</p>
            <button
              type="button"
              onClick={() => openModal({ kind: "conclusion", agendaId: agenda.id })}
              className="mt-2 text-[11px] text-emerald-300/80 hover:underline"
            >
              결론 수정
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">
            아직 결론이 없어요. 단계를 <b className="text-sub">확정</b> 이후로 바꾸면 한 줄 결론을 남겨요.
            {agenda.conclusion && (
              <p className="mt-2 text-[11px]">
                이전 결론: <span className="text-sub">{agenda.conclusion}</span>
              </p>
            )}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>설명</SectionTitle>
        {agenda.description ? (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-sub">{agenda.description}</p>
        ) : (
          <p className="text-xs text-muted">설명이 없어요.</p>
        )}
      </section>

    </div>
  );
}

/** 상위 경로(빵부스러기)와 하위 안건 목록 */
function AgendaHierarchy({ agenda }: { agenda: Agenda }) {
  const agendas = useRoom((s) => s.agendas);
  const path = useMemo(() => ancestorsOf(agenda.id, agendas), [agenda.id, agendas]);
  const children = useMemo(
    () =>
      Object.values(agendas)
        .filter((a) => a.parent_id === agenda.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [agenda.id, agendas],
  );

  return (
    <section>
      <SectionTitle>구조</SectionTitle>
      {path.length > 0 ? (
        <nav aria-label="상위 안건" className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted">
          {path.map((p) => (
            <span key={p.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => selectAgenda(p.id)}
                className="max-w-[10rem] truncate hover:text-fg hover:underline"
              >
                {p.title}
              </button>
              <span aria-hidden>›</span>
            </span>
          ))}
          <span className="text-sub">이 안건</span>
        </nav>
      ) : (
        <p className="mb-2 text-xs text-muted">최상위 안건이에요.</p>
      )}
      {children.length > 0 && (
        <ul className="mb-1 flex flex-col">
          {children.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => selectAgenda(c.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-sub hover:bg-hover hover:text-fg"
              >
                <span className="text-muted">└</span>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <StatusBadge status={c.status} small />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OnlineMembers() {
  const members = useRoom((s) => s.members);
  const presence = useRoom((s) => s.presence);
  const agendas = useRoom((s) => s.agendas);
  const userId = useRoom((s) => s.userId);
  const list = Object.values(members).sort((a, b) => a.slot - b.slot);
  const onlineCount = list.filter((m) => presence[m.user_id]).length;

  return (
    <section className="px-4 py-4">
      <SectionTitle>
        멤버 <span className="font-normal text-muted">· 접속 {onlineCount}/{list.length}</span>
      </SectionTitle>
      <ul className="flex flex-col gap-2.5">
        {list.map((m) => {
          const p = presence[m.user_id];
          const viewing = p?.agendaId ? agendas[p.agendaId] : undefined;
          return (
            <li key={m.user_id} className="flex items-start gap-2.5">
              <span className="relative mt-0.5">
                <span
                  className="flex size-7 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ background: `${memberColor(m.slot)}22`, color: memberColor(m.slot) }}
                >
                  {m.nickname.slice(0, 1)}
                </span>
                <span
                  className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-panel ${
                    p ? "bg-ok" : "bg-zinc-600"
                  }`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span style={{ color: memberColor(m.slot) }} className="font-medium">
                    {m.nickname}
                  </span>
                  {m.user_id === userId && <span className="ml-1 text-[11px] text-muted">(나)</span>}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {!p ? "오프라인" : viewing ? `‘${viewing.title}’ 보는 중` : "접속 중"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold text-sub">{children}</h4>;
}
