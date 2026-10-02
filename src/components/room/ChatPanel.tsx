"use client";

import { useCallback, useLayoutEffect, useRef, useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { loadOlder, loadUntil, sendMessage } from "@/lib/actions";
import { MESSAGE_MAX, memberColor, showsConclusion } from "@/lib/constants";
import { dayKey, formatDate, formatTime, toMs } from "@/lib/format";
import { sendTyping, sendTypingStop } from "@/lib/realtime";
import { showToast, useRoom } from "@/lib/store";
import type { Agenda, ChatMessage, Message } from "@/lib/types";
import { IconButton, Spinner } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { isComposingEnter, MessageItem } from "./MessageItem";
import { StatusBadge } from "./StatusBadge";

const GROUP_GAP_MS = 5 * 60 * 1000;
const drafts = new Map<string, string>();

export function ChatPanel() {
  const agenda = useRoom((s) => (s.selectedId ? s.agendas[s.selectedId] : undefined));
  if (!agenda) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="text-4xl opacity-60">🕯️</div>
        <p className="text-sm text-sub">왼쪽에서 안건을 고르거나 새 안건을 만들어 보세요.</p>
        <p className="text-xs text-muted">안건마다 대화가 따로 쌓이고, 결론이 남아요.</p>
      </div>
    );
  }
  return <AgendaChat key={agenda.id} agenda={agenda} />;
}

function AgendaChat({ agenda }: { agenda: Agenda }) {
  const thread = useRoom((s) => s.threads[agenda.id]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<{ scrollToMessage: (id: string) => void } | null>(null);

  const jumpTo = useCallback(
    async (m: Message) => {
      await loadUntil(agenda.id, m.created_at);
      requestAnimationFrame(() => {
        listRef.current?.scrollToMessage(m.id);
        setHighlightId(m.id);
        setTimeout(() => setHighlightId((h) => (h === m.id ? null : h)), 1700);
      });
    },
    [agenda.id],
  );

  return (
    <>
      <header className="flex items-center gap-1.5 border-b border-line px-2 py-2.5 md:px-4">
        <IconButton
          label="안건 목록"
          className="md:hidden"
          onClick={() => useRoom.setState({ panel: "list" })}
        >
          <Icon name="back" className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1 px-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold">{agenda.title}</h2>
            <StatusBadge status={agenda.status} small />
          </div>
          {showsConclusion(agenda.status, agenda.conclusion) ? (
            <p className="truncate text-xs text-ok/90">결론: {agenda.conclusion}</p>
          ) : agenda.description ? (
            <p className="truncate text-xs text-muted">{agenda.description}</p>
          ) : null}
        </div>
        <IconButton
          label="안건 정보"
          className="lg:hidden"
          onClick={() => useRoom.setState({ panel: "info" })}
        >
          <Icon name="info" className="size-5" />
        </IconButton>
      </header>

      {thread && <PinnedBar pinned={thread.pinned} onJump={jumpTo} />}

      {!thread || thread.loading ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner className="size-5" />
        </div>
      ) : (
        <MessageList agendaId={agenda.id} handleRef={listRef} highlightId={highlightId} />
      )}

      <TypingIndicator agendaId={agenda.id} />
      <Composer agendaId={agenda.id} />
    </>
  );
}

function PinnedBar({ pinned, onJump }: { pinned: Message[]; onJump: (m: Message) => void }) {
  const [open, setOpen] = useState(false);
  const members = useRoom((s) => s.members);
  if (!pinned.length) return null;
  const latest = pinned[pinned.length - 1];
  const slotOf = (m: Message) => (m.sender_id ? members[m.sender_id]?.slot : undefined);

  return (
    <div className="border-b border-line bg-panel/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs hover:bg-hover/50"
      >
        <span className="shrink-0">📌</span>
        <span className="shrink-0 font-medium text-sub">고정된 메시지 {pinned.length}개</span>
        {!open && <span className="min-w-0 flex-1 truncate text-muted">{latest.content}</span>}
        <Icon
          name="chevron"
          className={`ml-auto size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="max-h-64 overflow-y-auto px-2 pb-2">
          {pinned.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onJump(m)}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
              >
                <span className="mr-2 text-xs font-semibold" style={{ color: memberColor(slotOf(m)) }}>
                  {m.sender_nickname}
                </span>
                <span className="text-[11px] text-muted">
                  {formatDate(m.created_at)} {formatTime(m.created_at)}
                </span>
                <p className="line-clamp-2 break-words whitespace-pre-wrap text-sub">{m.content}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shouldShowHeader(prev: ChatMessage | undefined, m: ChatMessage) {
  if (!prev) return true;
  if (prev.sender_id !== m.sender_id || prev.sender_nickname !== m.sender_nickname) return true;
  if (dayKey(prev.created_at) !== dayKey(m.created_at)) return true;
  return toMs(m.created_at) - toMs(prev.created_at) > GROUP_GAP_MS;
}

function MessageList({
  agendaId,
  handleRef,
  highlightId,
}: {
  agendaId: string;
  handleRef: React.RefObject<{ scrollToMessage: (id: string) => void } | null>;
  highlightId: string | null;
}) {
  const list = useRoom((s) => s.threads[agendaId]?.list ?? EMPTY);
  const hasMore = useRoom((s) => s.threads[agendaId]?.hasMore ?? false);
  const loadingOlder = useRoom((s) => s.threads[agendaId]?.loadingOlder ?? false);
  const members = useRoom((s) => s.members);
  const userId = useRoom((s) => s.userId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prev = useRef<{ firstId?: string; lastId?: string; height: number; count: number }>({
    height: 0,
    count: 0,
  });
  const [newCount, setNewCount] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    handleRef.current = {
      scrollToMessage: (id) => {
        document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      },
    };
  }, [handleRef]);

  // 새 메시지: 맨 아래에 있으면 따라 내려가고, 위로 올려 보고 있으면 "새 메시지" 버튼을 띄운다.
  // 이전 메시지를 위에 붙일 때는 보고 있던 위치를 유지한다.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const p = prev.current;
    const firstId = list[0]?.id;
    const lastId = list[list.length - 1]?.id;
    if (p.count === 0) {
      el.scrollTop = el.scrollHeight;
    } else if (firstId !== p.firstId && lastId === p.lastId) {
      el.scrollTop += el.scrollHeight - p.height;
    } else if (lastId !== p.lastId && list.length > p.count) {
      const last = list[list.length - 1];
      if (atBottom.current || (last.sender_id === userId && last.localStatus === "sending")) {
        el.scrollTop = el.scrollHeight;
      } else {
        const added = list.slice(p.count).filter((m) => m.sender_id !== userId).length;
        if (added) setNewCount((c) => c + added);
      }
    } else if (atBottom.current) {
      // 수정/핀 등으로 높이가 바뀐 경우에도 바닥에 붙어 있게
      el.scrollTop = el.scrollHeight;
    }
    prev.current = { firstId, lastId, height: el.scrollHeight, count: list.length };
  }, [list, userId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && newCount) setNewCount(0);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewCount(0);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain pb-3"
        role="log"
        aria-live="polite"
      >
        {hasMore ? (
          <div className="flex justify-center py-3">
            <button
              type="button"
              onClick={() => void loadOlder(agendaId)}
              disabled={loadingOlder}
              className="rounded-full border border-line px-3 py-1 text-xs text-sub hover:bg-hover"
            >
              {loadingOlder ? <Spinner className="size-3" /> : "이전 메시지 더 보기"}
            </button>
          </div>
        ) : (
          list.length === 0 && (
            <p className="px-6 py-16 text-center text-sm text-muted">
              첫 메시지를 남겨 이야기를 시작해 보세요.
            </p>
          )
        )}

        {list.map((m, i) => {
          const before = list[i - 1];
          const newDay = !before || dayKey(before.created_at) !== dayKey(m.created_at);
          const member = m.sender_id ? members[m.sender_id] : undefined;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-4 flex items-center gap-3 px-4 text-[11px] text-muted">
                  <span className="h-px flex-1 bg-line" />
                  {formatDate(m.created_at)}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              <MessageItem
                message={m}
                showHeader={newDay || shouldShowHeader(before, m)}
                isMine={m.sender_id === userId}
                slot={member?.slot}
                senderLeft={!member}
                highlighted={highlightId === m.id}
                active={activeId === m.id}
                onActivate={setActiveId}
              />
            </div>
          );
        })}
      </div>

      {newCount > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="animate-fade-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-accent-hover"
        >
          <Icon name="down" className="size-3.5" />
          새 메시지 {newCount}개
        </button>
      )}
    </div>
  );
}

const EMPTY: ChatMessage[] = [];

function TypingIndicator({ agendaId }: { agendaId: string }) {
  const names = useRoom(
    useShallow((s) =>
      Object.entries(s.typing)
        .filter(([, t]) => t.agendaId === agendaId)
        .map(([uid]) => s.members[uid]?.nickname)
        .filter((n): n is string => Boolean(n)),
    ),
  );
  return (
    <div className="h-5 px-4 text-xs text-sub" aria-live="polite">
      {names.length > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex gap-0.5">
            <span className="typing-dot size-1 rounded-full bg-sub" />
            <span className="typing-dot size-1 rounded-full bg-sub" />
            <span className="typing-dot size-1 rounded-full bg-sub" />
          </span>
          <span>
            <b className="font-medium text-fg">{names.join(", ")}</b> 입력 중...
          </span>
        </span>
      )}
    </div>
  );
}

function Composer({ agendaId }: { agendaId: string }) {
  const [text, setText] = useState(() => drafts.get(agendaId) ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (text) drafts.set(agendaId, text);
    else drafts.delete(agendaId);
  }, [agendaId, text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) ref.current?.focus();
    return () => sendTypingStop(agendaId);
  }, [agendaId]);

  const submit = () => {
    const content = text.trim();
    if (!content) return;
    if (content.length > MESSAGE_MAX) {
      showToast(`메시지는 ${MESSAGE_MAX.toLocaleString()}자까지 보낼 수 있어요.`);
      return;
    }
    sendMessage(agendaId, content);
    setText("");
    sendTypingStop(agendaId);
  };

  return (
    <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4">
      <div className="flex items-end gap-2 rounded-xl border border-line bg-elev px-3 py-2 focus-within:border-accent/50">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) sendTyping(agendaId);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isComposingEnter(e)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="메시지 입력 (Enter 전송 · Shift+Enter 줄바꿈)"
          aria-label="메시지 입력"
          className="max-h-[200px] min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed outline-none placeholder:text-muted/70"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="보내기"
          className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:bg-transparent disabled:text-muted"
        >
          <Icon name="send" className="size-4" />
        </button>
      </div>
      {text.length > MESSAGE_MAX - 500 && (
        <p className={`mt-1 text-right text-[11px] ${text.length > MESSAGE_MAX ? "text-accent" : "text-muted"}`}>
          {text.length.toLocaleString()} / {MESSAGE_MAX.toLocaleString()}
        </p>
      )}
    </div>
  );
}
