"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

/** 마인드맵 / 대화 최소 너비(px) */
export const MAP_MIN_PX = 320;
export const CHAT_MIN_PX = 360;
const DEFAULT_RATIO = 0.5;
const STORAGE_KEY = "split-ratio";

function readRatio() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return v > 0 && v < 1 ? v : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}

function saveRatio(v: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(v));
  } catch {
    // 저장 못 해도 이번 화면에서는 동작
  }
}

/** 왼쪽(마인드맵) 비율. 브라우저마다 기억한다 */
export function useSplitRatio() {
  return useState(readRatio);
}

function clampRatio(ratio: number, width: number) {
  if (!width) return ratio;
  const min = MAP_MIN_PX / width;
  const max = 1 - CHAT_MIN_PX / width;
  return min > max ? 0.5 : Math.min(max, Math.max(min, ratio));
}

/** 마인드맵과 대화 사이 경계선. 끌기 / 화살표 키 / 더블클릭(초기화) */
export function SplitDivider({
  containerRef,
  ratio,
  onChange,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  ratio: number;
  onChange: (ratio: number) => void;
}) {
  const latest = useRef(ratio);
  const [dragging, setDragging] = useState(false);

  const update = (next: number) => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0;
    latest.current = clampRatio(next, width);
    onChange(latest.current);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: globalThis.PointerEvent) => update((ev.clientX - rect.left) / rect.width);
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
      saveRatio(latest.current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    if (e.key === "ArrowLeft") update(ratio - step);
    else if (e.key === "ArrowRight") update(ratio + step);
    else return;
    e.preventDefault();
    saveRatio(latest.current);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="마인드맵과 대화 사이 경계 (끌어서 너비 조절, 더블클릭하면 반반)"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title="끌어서 너비 조절 · 더블클릭하면 반반"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        update(DEFAULT_RATIO);
        saveRatio(latest.current);
      }}
      className="group relative z-10 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none outline-none md:block"
    >
      <span
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-[width,background-color] ${
          dragging ? "w-0.5 bg-accent" : "w-px bg-line group-hover:w-0.5 group-hover:bg-accent/60 group-focus-visible:bg-accent"
        }`}
      />
    </div>
  );
}
