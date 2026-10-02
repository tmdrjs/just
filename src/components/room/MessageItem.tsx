"use client";

import { Fragment, memo, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { discardMessage, editMessage, retryMessage, setPinned } from "@/lib/actions";
import { MESSAGE_MAX, memberColor } from "@/lib/constants";
import { formatTime } from "@/lib/format";
import { isOmokMessage } from "@/lib/omok";
import { isYachtMessage } from "@/lib/yacht";
import { openModal } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { OmokBoard } from "./OmokBoard";
import { YachtBoard } from "./YachtBoard";

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sky-300 underline underline-offset-2 hover:text-sky-200"
          >
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function isComposingEnter(e: KeyboardEvent) {
  // 한글 IME 조합 중 Enter는 무시해야 마지막 글자가 두 번 전송되지 않는다
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export const MessageItem = memo(function MessageItem({
  message: m,
  showHeader,
  isMine,
  slot,
  senderLeft,
  highlighted,
  active,
  onActivate,
}: {
  message: ChatMessage;
  showHeader: boolean;
  isMine: boolean;
  slot: number | undefined;
  senderLeft: boolean;
  highlighted: boolean;
  active: boolean;
  onActivate: (id: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const deleted = Boolean(m.deleted_at);
  const color = memberColor(senderLeft ? null : slot);
  const canAct = !deleted && !m.localStatus;
  // "!오목" / "!야추" 메시지는 게임판으로 보여 주고, 글 수정은 막는다 (판이 사라지지 않게)
  const game = deleted ? null : isOmokMessage(m.content) ? "omok" : isYachtMessage(m.content) ? "yacht" : null;
  const isGame = game !== null;

  return (
    <div
      id={`msg-${m.id}`}
      onClick={(e) => {
        if (window.matchMedia("(hover: none)").matches && !(e.target as HTMLElement).closest("a,button,textarea")) {
          onActivate(active ? null : m.id);
        }
      }}
      className={`group relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 px-4 py-0.5 ${
        showHeader ? "mt-3 pt-1" : ""
      } ${active ? "bg-hover/60" : "hover:bg-hover/40"} ${highlighted ? "animate-flash" : ""} ${
        m.localStatus === "sending" ? "opacity-60" : ""
      }`}
    >
      {m.is_pinned && !deleted && (
        <span aria-hidden className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-accent/70" />
      )}
      <div className="flex justify-center">
        {showHeader ? (
          <span
            className="mt-0.5 flex size-9 items-center justify-center rounded-full text-sm font-semibold"
            style={{ background: `${color}22`, color }}
            aria-hidden
          >
            {m.sender_nickname.slice(0, 1)}
          </span>
        ) : (
          <time className="invisible pt-1 text-[10px] text-muted tabular-nums group-hover:visible">
            {formatTime(m.created_at)}
          </time>
        )}
      </div>

      <div className="min-w-0">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold" style={{ color }}>
              {m.sender_nickname}
            </span>
            {senderLeft && <span className="text-[11px] text-muted">(나감)</span>}
            <time className="text-[11px] text-muted tabular-nums">{formatTime(m.created_at)}</time>
            {m.is_pinned && !deleted && (
              <span className="text-[11px] text-accent-hover" title="고정됨">
                📌
              </span>
            )}
          </div>
        )}

        {editing ? (
          <EditBox
            initial={m.content}
            onCancel={() => setEditing(false)}
            onSave={async (content) => {
              setEditing(false);
              if (content !== m.content) await editMessage(m.id, content);
            }}
          />
        ) : game === "omok" ? (
          <OmokBoard messageId={m.id} pending={Boolean(m.localStatus)} />
        ) : game === "yacht" ? (
          <YachtBoard messageId={m.id} pending={Boolean(m.localStatus)} />
        ) : (
          <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg/95">
            {deleted ? (
              <span className="text-sm text-muted italic">삭제된 메시지예요</span>
            ) : (
              <Linkified text={m.content} />
            )}
            {m.edited_at && !deleted && <span className="ml-1.5 text-[11px] text-muted">(수정됨)</span>}
            {!showHeader && m.is_pinned && !deleted && <span className="ml-1.5 text-[11px]">📌</span>}
          </div>
        )}

        {m.localStatus === "sending" && <p className="text-[11px] text-muted">전송 중…</p>}
        {m.localStatus === "failed" && (
          <p className="mt-0.5 flex items-center gap-2 text-xs text-accent-hover">
            전송 실패
            <button
              type="button"
              onClick={() => retryMessage(m.agenda_id, m.id)}
              className="inline-flex items-center gap-1 rounded border border-accent/40 px-1.5 py-0.5 hover:bg-accent/10"
            >
              <Icon name="retry" className="size-3" /> 재시도
            </button>
            <button
              type="button"
              onClick={() => discardMessage(m.agenda_id, m.id)}
              className="text-muted underline-offset-2 hover:underline"
            >
              지우기
            </button>
          </p>
        )}
      </div>

      {canAct && !editing && (
        <div
          className={`absolute -top-3 right-3 z-10 items-center rounded-lg border border-line bg-elev p-0.5 shadow-lg ${
            active ? "flex" : "hidden group-hover:flex"
          }`}
        >
          <ToolButton
            label={m.is_pinned ? "핀 해제" : "핀 고정"}
            onClick={() => {
              onActivate(null);
              void setPinned(m, !m.is_pinned);
            }}
            activeTone={m.is_pinned}
          >
            <Icon name="pin" className="size-4" />
          </ToolButton>
          {isMine && (
            <>
              {!isGame && (
                <ToolButton
                  label="수정"
                  onClick={() => {
                    onActivate(null);
                    setEditing(true);
                  }}
                >
                  <Icon name="edit" className="size-4" />
                </ToolButton>
              )}
              <ToolButton
                label="삭제"
                onClick={() => {
                  onActivate(null);
                  openModal({ kind: "deleteMessage", message: m });
                }}
              >
                <Icon name="trash" className="size-4" />
              </ToolButton>
            </>
          )}
        </div>
      )}
    </div>
  );
});

function ToolButton({
  label,
  onClick,
  children,
  activeTone,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  activeTone?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-md hover:bg-hover ${
        activeTone ? "text-accent-hover" : "text-sub hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function EditBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useLayoutEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = () => {
    const content = text.trim();
    if (!content) return;
    onSave(content);
  };

  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        value={text}
        maxLength={MESSAGE_MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey && !isComposingEnter(e)) {
            e.preventDefault();
            save();
          }
        }}
        rows={1}
        className="w-full resize-none rounded-lg border border-accent/50 bg-bg px-3 py-2 text-[15px] leading-relaxed outline-none"
      />
      <p className="mt-1 text-[11px] text-muted">
        Esc{" "}
        <button type="button" onClick={onCancel} className="text-sky-300 hover:underline">
          취소
        </button>{" "}
        · Enter{" "}
        <button type="button" onClick={save} className="text-sky-300 hover:underline">
          저장
        </button>
      </p>
    </div>
  );
}
