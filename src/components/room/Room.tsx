"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { fetchAgendas, fetchMembers, fetchUnread, onVisible } from "@/lib/actions";
import { connectRealtime } from "@/lib/realtime";
import { initialRoomState, useRoom } from "@/lib/store";
import { Spinner } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { AgendaSidebar } from "./AgendaSidebar";
import { ChatPanel } from "./ChatPanel";
import { DetailPanel } from "./DetailPanel";
import { HorrorLayer } from "./HorrorLayer";
import { Modals } from "./Modals";
import { CHAT_MIN_PX, MAP_MIN_PX, SplitDivider, useSplitRatio } from "./SplitDivider";

const KICKED_NOTICE =
  "다른 기기에서 이 닉네임으로 다시 연결했거나 자리가 비워져서, 이 브라우저의 연결이 해제됐어요.";

export function Room({ userId, onExit }: { userId: string; onExit: (notice?: string) => void }) {
  const ready = useRoom((s) => s.userId === userId && s.membersLoaded && s.agendasLoaded);
  const kicked = useRoom((s) => s.kicked);
  const panel = useRoom((s) => s.panel);
  const splitRef = useRef<HTMLDivElement>(null);
  const [mapRatio, setMapRatio] = useSplitRatio();
  const connection = useRoom((s) => s.connection);
  const toast = useRoom((s) => s.toast);
  const totalUnread = useRoom((s) => Object.values(s.unread).reduce((a, b) => a + b, 0));

  useEffect(() => {
    useRoom.setState(initialRoomState(userId), true);
    void fetchMembers();
    void fetchAgendas();
    void fetchUnread();
    const disconnect = connectRealtime(userId);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      onVisible();
      void fetchMembers();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // 다른 기기에서 내 자리를 가져갔는지 주기적으로 확인
    const poll = setInterval(() => void fetchMembers(), 60_000);

    return () => {
      disconnect();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);

  useEffect(() => {
    if (kicked) onExit(KICKED_NOTICE);
  }, [kicked, onExit]);

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) 공포게임 기획실` : "공포게임 기획실";
  }, [totalUnread]);

  if (!ready) {
    return (
      <main className="flex h-dvh items-center justify-center">
        <Spinner className="size-6 text-accent" />
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {connection === "offline" && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-accent px-3 py-1.5 text-xs font-medium text-white"
        >
          <Icon name="wifiOff" className="size-3.5" />
          연결 끊김 · 다시 연결하는 중이에요. 연결되면 놓친 메시지를 자동으로 불러와요.
        </div>
      )}
      {/* 왼쪽 마인드맵 | 경계선 | 대화. 안건 정보는 ⓘ 로 여는 서랍. 모바일은 한 화면씩 */}
      <div
        ref={splitRef}
        className="flex min-h-0 flex-1"
        style={
          {
            "--map-basis": `${mapRatio * 100}%`,
            "--map-min": `${MAP_MIN_PX}px`,
            "--chat-min": `${CHAT_MIN_PX}px`,
          } as CSSProperties
        }
      >
        <aside
          className={`${panel === "list" ? "flex" : "hidden"} w-full flex-col bg-panel md:flex md:w-auto md:min-w-(--map-min) md:shrink md:grow-0 md:basis-(--map-basis)`}
        >
          <AgendaSidebar />
        </aside>
        <SplitDivider containerRef={splitRef} ratio={mapRatio} onChange={setMapRatio} />
        <main
          className={`${panel === "list" ? "hidden" : "flex"} min-w-0 flex-1 flex-col md:flex md:min-w-(--chat-min)`}
        >
          <ChatPanel />
        </main>
        <aside
          className={`${panel === "info" ? "fixed inset-0 z-40 flex sm:left-auto sm:w-96 sm:border-l sm:shadow-2xl" : "hidden"} flex-col border-line bg-panel`}
        >
          <DetailPanel />
        </aside>
        {panel === "info" && (
          <div
            className="fixed inset-0 z-30 hidden bg-black/50 sm:block"
            onClick={() => useRoom.setState({ panel: "chat" })}
          />
        )}
      </div>
      <HorrorLayer />
      <Modals onLeft={() => onExit()} />
      {toast && (
        <div
          key={toast.id}
          role="status"
          className="animate-fade-in fixed bottom-24 left-1/2 z-[60] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-line bg-elev px-4 py-2.5 text-center text-sm shadow-xl"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
