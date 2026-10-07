"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { useRoom } from "@/lib/store";
import { Button, Spinner } from "../ui/Button";

// three.js 는 무거워서 게임을 열 때만 불러온다
const HorrorGame = dynamic(() => import("../horror/HorrorGame").then((m) => m.HorrorGame), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6 text-accent" />
    </div>
  ),
});

const close = () => useRoom.setState({ horror: false });

/** 방 위에 덮는 3D 공포게임. 뒤에서 채팅·실시간 연결은 그대로 돌아간다 */
export function HorrorLayer() {
  const open = useRoom((s) => s.horror);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black">
      <GameErrorBoundary>
        <HorrorGame onExit={close} />
      </GameErrorBoundary>
    </div>
  );
}

/** WebGL 을 못 쓰는 기기 등에서 게임이 터져도 방 전체가 멈추지 않게 */
class GameErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-sub">이 기기에서는 3D 게임을 불러오지 못했어요.</p>
        <Button onClick={close}>기획실로 돌아가기</Button>
      </div>
    );
  }
}
