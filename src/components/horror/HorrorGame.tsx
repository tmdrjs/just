"use client";

import { Canvas } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { HorrorAudio } from "./audio";
import { EYE_HEIGHT, ITEM_NAME, START_Z, type ItemId } from "./layout";
import { createHorrorState, resetRun, type CaughtReason, type HorrorState, type Phase } from "./state";
import { World, type WorldEvents } from "./World";

const MOUSE_SENSITIVITY = 0.0022;
const DRAG_SENSITIVITY = 0.006;
/** 게임이 가져가는 키 (페이지 스크롤 등 기본 동작을 막는다) */
const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "Space",
]);

const CAUGHT_TEXT: Record<CaughtReason, string> = {
  turned: "뒤를 돌아봤구나.",
  waited: "너무 오래 머뭇거렸다.",
};

/** 1인칭 3D 공포게임 "복도". 데스크톱은 마우스 잠금 + WASD, 터치는 끌어서 둘러보기 + 걷기 버튼 */
export function HorrorGame({ onExit }: { onExit: () => void }) {
  const gameRef = useRef(createHorrorState());
  const rootRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("intro");
  const [phase, setPhaseState] = useState<Phase>("intro");
  const [run, setRun] = useState(0);
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  /** 화면 가운데의 상호작용 안내 (예: "문 열기") */
  const [prompt, setPrompt] = useState<string | null>(null);
  const [scareId, setScareId] = useState(0);
  const [caught, setCaught] = useState<CaughtReason | null>(null);
  const [items, setItems] = useState<ItemId[]>([]);
  const [muted, setMuted] = useState(false);
  const [touch] = useState(() => window.matchMedia("(hover: none)").matches);
  const msgSeq = useRef(0);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    gameRef.current.playing = next === "playing";
    if (next !== "playing") {
      gameRef.current.keys.clear();
      gameRef.current.touchMove = 0;
    }
    setPhaseState(next);
  }, []);

  const say = useCallback((text: string, ms = 3000) => {
    const id = ++msgSeq.current;
    setMessage({ id, text });
    setTimeout(() => setMessage((m) => (m?.id === id ? null : m)), ms);
  }, []);

  const lock = useCallback(() => {
    if (touch || document.pointerLockElement) return;
    try {
      // 브라우저에 따라 Promise 를 돌려주고, 잠금을 푼 직후(약 1초)에는 거절될 수 있다.
      // 실패하면 마우스로 끌어서 둘러보기로 계속할 수 있다
      void Promise.resolve(rootRef.current?.requestPointerLock()).catch(() => {});
    } catch {}
  }, [touch]);

  const pause = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    setPhase("paused");
    void gameRef.current.audio?.suspend();
    if (document.pointerLockElement) document.exitPointerLock();
  }, [setPhase]);

  const toggleMute = useCallback(() => {
    const s = gameRef.current;
    s.muted = !s.muted;
    s.audio?.setMuted(s.muted);
    setMuted(s.muted);
  }, []);

  const play = () => {
    const s = gameRef.current;
    // AudioContext 는 사용자가 버튼을 누른 이 순간에 만들어야 소리가 난다
    if (!s.audio) {
      s.audio = new HorrorAudio();
      s.audio.setMuted(s.muted);
    }
    void s.audio.resume();
    setPhase("playing");
    lock();
  };

  const start = () => {
    play();
    say("복도 끝 비상구로 나가자.", 3500);
  };

  const restart = () => {
    resetRun(gameRef.current);
    setCaught(null);
    setMessage(null);
    setPrompt(null);
    setItems([]);
    setRun((r) => r + 1);
    start();
  };

  const events = useMemo<WorldEvents>(
    () => ({
      onMessage: say,
      onFocus: setPrompt,
      onItems: setItems,
      onScare: () => setScareId((n) => n + 1),
      onCaught: (reason) => {
        setCaught(reason);
        setPhase("caught");
        if (document.pointerLockElement) document.exitPointerLock();
      },
      onEscape: () => {
        setPhase("escaped");
        setMessage(null);
        // 계단실에 들어서는 순간 모든 소리가 끊긴다
        void gameRef.current.audio?.suspend();
        if (document.pointerLockElement) document.exitPointerLock();
      },
    }),
    [say, setPhase],
  );

  useEffect(() => {
    const s = gameRef.current;
    const root = rootRef.current;
    // 뒤에 있는 채팅 입력창으로 글자가 들어가지 않게
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    root?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "KeyM") return toggleMute();
      if (e.code === "KeyE") {
        if (phaseRef.current === "playing" && !e.repeat) s.interact = true;
        return;
      }
      if (e.code === "Escape") {
        // 마우스가 잠겨 있으면 브라우저가 Esc 로 잠금을 풀고 pointerlockchange 로 일시정지된다
        if (phaseRef.current === "playing") pause();
        else if (phaseRef.current !== "paused") onExit();
        return;
      }
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (phaseRef.current === "playing") s.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => s.keys.delete(e.code);
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== root) return;
      s.look.x += e.movementX;
      s.look.y += e.movementY;
      s.look.sensitivity = MOUSE_SENSITIVITY;
    };
    const onLockChange = () => {
      if (!document.pointerLockElement) pause();
    };
    const onBlur = () => s.keys.clear();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pause();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("blur", onBlur);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("visibilitychange", onVisibility);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [onExit, pause, toggleMute]);

  useEffect(() => {
    const s = gameRef.current;
    return () => {
      void s.audio?.close();
      s.audio = null;
    };
  }, []);

  const endDrag = (e: PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative h-full w-full touch-none overflow-hidden outline-none select-none"
      onContextMenu={(e) => e.preventDefault()}
      // 마우스 잠금이 안 될 때(터치·일부 브라우저)는 끌어서 둘러본다
      onPointerDown={(e) => {
        if (phaseRef.current !== "playing") return;
        if (e.pointerType === "mouse") lock();
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId || document.pointerLockElement) return;
        const s = gameRef.current;
        s.look.x += e.clientX - d.x;
        s.look.y += e.clientY - d.y;
        s.look.sensitivity = DRAG_SENSITIVITY;
        d.x = e.clientX;
        d.y = e.clientY;
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <Canvas
        camera={{ fov: 70, near: 0.05, far: 60, position: [0, EYE_HEIGHT, START_Z] }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <World key={run} gameRef={gameRef} events={events} />
      </Canvas>

      <div aria-hidden className="horror-vignette pointer-events-none absolute inset-0" />
      <div aria-hidden className="horror-grain pointer-events-none absolute" />
      {scareId > 0 && (
        <div key={scareId} aria-hidden className="animate-scare pointer-events-none absolute inset-0 bg-accent" />
      )}

      {phase === "playing" && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40"
        />
      )}
      {phase === "playing" && prompt && !touch && (
        <p className="pointer-events-none absolute top-1/2 left-1/2 mt-8 flex -translate-x-1/2 items-center gap-2 text-sm text-fg/90 [text-shadow:0_0_8px_#000]">
          <kbd className="rounded border border-white/40 bg-black/40 px-1.5 py-0.5 font-sans text-xs">E</kbd>
          {prompt}
        </p>
      )}
      {message && (
        <p
          key={message.id}
          role="status"
          className="animate-fade-in pointer-events-none absolute inset-x-0 bottom-[22%] px-6 text-center text-lg font-medium tracking-wide text-fg/90 [text-shadow:0_0_12px_#000]"
        >
          {message.text}
        </p>
      )}

      <div className="absolute top-3 right-3 flex gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
        <HudButton label={muted ? "소리 켜기 (M)" : "소리 끄기 (M)"} onClick={toggleMute}>
          <Icon name={muted ? "volumeOff" : "volume"} className="size-4" />
        </HudButton>
        {phase === "playing" && (
          <HudButton label="일시정지 (Esc)" onClick={pause}>
            <Icon name="pause" className="size-4" />
          </HudButton>
        )}
        <HudButton label="기획실로 돌아가기" onClick={onExit}>
          <Icon name="close" className="size-4" />
        </HudButton>
      </div>

      {items.length > 0 && (phase === "playing" || phase === "paused") && (
        <ul className="pointer-events-none absolute top-3 left-3 space-y-1 text-xs text-fg/85" aria-label="가진 물건">
          {items.map((id) => (
            <li key={id} className="rounded-md bg-black/50 px-2 py-1 backdrop-blur-sm">
              🔑 {ITEM_NAME[id]}
            </li>
          ))}
        </ul>
      )}
      {phase === "playing" && !touch && (
        <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-muted/70">
          E 상호작용 · Esc 일시정지 · Shift 달리기 · M 소리
        </p>
      )}
      {phase === "playing" && touch && <TouchWalk gameRef={gameRef} />}
      {phase === "playing" && touch && prompt && (
        <button
          type="button"
          className="absolute right-4 bottom-[max(1.5rem,env(safe-area-inset-bottom))] rounded-full bg-white/15 px-5 py-4 text-sm font-medium text-fg active:bg-white/30"
          onPointerDown={(e) => {
            e.stopPropagation();
            gameRef.current.interact = true;
          }}
        >
          {prompt}
        </button>
      )}

      {phase === "intro" && (
        <Screen>
          <p className="text-xs tracking-[0.3em] text-accent-hover">지하 3층</p>
          <h2 className="text-3xl font-bold tracking-widest">복도</h2>
          <p className="text-sm text-sub">복도 끝 비상구로 빠져나가세요.</p>
          <ul className="space-y-1 text-xs text-muted">
            {touch ? (
              <>
                <li>화면을 끌어서 둘러보기</li>
                <li>아래 버튼을 누르고 있으면 걷기 · 문 앞에서 오른쪽 버튼</li>
              </>
            ) : (
              <>
                <li>WASD · 방향키 이동 · Shift 달리기</li>
                <li>마우스로 둘러보기 · E 문 열기 · 줍기</li>
                <li>Esc 일시정지 · M 소리</li>
              </>
            )}
          </ul>
          <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-sub">
            갑자기 큰 소리와 붉은 화면이 나와요. 소리를 줄이고 시작하세요.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onExit}>
              나가기
            </Button>
            <Button variant="primary" onClick={start}>
              시작하기
            </Button>
          </div>
        </Screen>
      )}
      {phase === "paused" && (
        <Screen>
          <h2 className="text-xl font-semibold">일시정지</h2>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onExit}>
              나가기
            </Button>
            <Button variant="primary" onClick={play}>
              계속하기
            </Button>
          </div>
        </Screen>
      )}
      {phase === "caught" && (
        <Screen>
          <h2 className="text-4xl font-bold tracking-widest text-accent-hover">잡혔다.</h2>
          {caught && <p className="text-sm text-sub">{CAUGHT_TEXT[caught]}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onExit}>
              기획실로
            </Button>
            <Button variant="primary" onClick={restart}>
              다시 하기
            </Button>
          </div>
        </Screen>
      )}
      {phase === "escaped" && (
        <Screen className="animate-fade-slow bg-black">
          <h2 className="text-3xl font-bold tracking-widest">탈출했다.</h2>
          <p className="text-sm text-sub">끝까지 돌아보지 않았다.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onExit}>
              기획실로
            </Button>
            <Button variant="primary" onClick={restart}>
              다시 하기
            </Button>
          </div>
        </Screen>
      )}
    </div>
  );
}

function Screen({ children, className = "animate-fade-in bg-black/70" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center p-6 text-center ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex max-w-sm flex-col items-center gap-4">{children}</div>
    </div>
  );
}

function HudButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-lg bg-black/50 text-sub backdrop-blur-sm hover:bg-black/70 hover:text-fg"
    >
      {children}
    </button>
  );
}

/** 터치 화면: 누르고 있는 동안 걷는다 */
function TouchWalk({ gameRef }: { gameRef: RefObject<HorrorState> }) {
  return (
    <div className="absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-center gap-3">
      <WalkButton gameRef={gameRef} dir={-1} label="뒤로 걷기" />
      <WalkButton gameRef={gameRef} dir={1} label="앞으로 걷기" />
    </div>
  );
}

function WalkButton({ gameRef, dir, label }: { gameRef: RefObject<HorrorState>; dir: number; label: string }) {
  const release = () => {
    gameRef.current.touchMove = 0;
  };
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-14 items-center justify-center rounded-full bg-white/10 text-sub active:bg-white/25"
      onPointerDown={(e: PointerEvent) => {
        e.stopPropagation();
        gameRef.current.touchMove = dir;
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <Icon name="down" className={`size-5 ${dir > 0 ? "rotate-180" : ""}`} />
    </button>
  );
}
