"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { errorMessage, memberColor, NICKNAME_MAX } from "@/lib/constants";
import { getSupabase } from "@/lib/supabase";
import type { RpcResult } from "@/lib/types";
import { Button, Spinner } from "./ui/Button";
import { Label, TextInput } from "./ui/Field";

type Mode = "join" | "full" | "reclaim";

interface MemberSeat {
  nickname: string;
  slot: number;
}

export function EntryScreen({ notice, onJoined }: { notice?: string; onJoined: () => void }) {
  const [mode, setMode] = useState<Mode>("join");
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [seats, setSeats] = useState<MemberSeat[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const goReclaim = () => {
    setError(null);
    setSeats(null);
    setPicked(null);
    setMode("reclaim");
  };

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await getSupabase().rpc("join_room", {
      p_code: code.trim(),
      p_nickname: nickname.trim(),
    });
    setBusy(false);
    const result = data as RpcResult | null;
    if (rpcError || !result) return setError(errorMessage(undefined));
    if (result.ok) return onJoined();
    if (result.error === "ROOM_FULL") return setMode("full");
    if (result.error === "NICKNAME_TAKEN") {
      return setError(
        <>
          이미 사용 중인 닉네임이에요. 본인이라면{" "}
          <button type="button" onClick={goReclaim} className="underline underline-offset-2">
            기존 멤버로 다시 연결하기
          </button>
          를 이용해 주세요.
        </>,
      );
    }
    setError(errorMessage(result.error));
  }

  async function loadSeats(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await getSupabase().rpc("get_member_list", {
      p_code: code.trim(),
    });
    setBusy(false);
    const result = data as RpcResult<{ members: MemberSeat[] }> | null;
    if (rpcError || !result) return setError(errorMessage(undefined));
    if (!result.ok) return setError(errorMessage(result.error));
    setSeats(result.members);
    if (!result.members.length) setError("아직 등록된 멤버가 없어요. 새로 입장해 주세요.");
  }

  async function reclaim() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await getSupabase().rpc("reclaim_member", {
      p_code: code.trim(),
      p_nickname: picked,
    });
    setBusy(false);
    const result = data as RpcResult | null;
    if (rpcError || !result) return setError(errorMessage(undefined));
    if (result.ok) return onJoined();
    setError(errorMessage(result.error));
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(220,38,64,0.14),transparent_55%)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-line bg-panel text-2xl">
            🕯️
          </div>
          <h1 className="text-xl font-semibold tracking-tight">공포게임 기획실</h1>
          <p className="mt-1.5 text-sm text-muted">초대받은 사람만 들어올 수 있어요 · 최대 3명</p>
        </div>

        {notice && (
          <p className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5 text-sm text-warn">
            {notice}
          </p>
        )}

        <div className="rounded-2xl border border-line bg-panel/90 p-5 shadow-2xl backdrop-blur">
          {mode === "join" && (
            <form onSubmit={join} className="flex flex-col gap-4">
              <div>
                <Label>초대 코드</Label>
                <TextInput
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="받은 초대 코드를 입력"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  autoFocus
                />
              </div>
              <div>
                <Label hint={`${nickname.trim().length}/${NICKNAME_MAX}`}>닉네임</Label>
                <TextInput
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="방에서 쓸 이름"
                  maxLength={NICKNAME_MAX + 4}
                  autoComplete="nickname"
                  required
                />
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !code.trim() || !nickname.trim()}
                className="py-2.5"
              >
                {busy ? <Spinner /> : "입장하기"}
              </Button>
              <button
                type="button"
                onClick={goReclaim}
                className="text-xs text-muted underline-offset-2 hover:text-sub hover:underline"
              >
                예전에 들어왔던 멤버인가요? 기존 멤버로 다시 연결하기
              </button>
            </form>
          )}

          {mode === "full" && (
            <div className="flex flex-col gap-4 text-center">
              <div className="text-3xl">🚪</div>
              <div>
                <h2 className="font-semibold">자리가 가득 찼어요</h2>
                <p className="mt-1.5 text-sm text-sub">
                  이 방은 최대 3명까지 들어올 수 있어요.
                  <br />
                  이미 멤버였다면 기존 닉네임으로 다시 연결할 수 있어요.
                </p>
              </div>
              <Button variant="primary" onClick={goReclaim} className="py-2.5">
                기존 멤버로 다시 연결하기
              </Button>
              <Button variant="ghost" onClick={() => setMode("join")}>
                돌아가기
              </Button>
            </div>
          )}

          {mode === "reclaim" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-semibold">기존 멤버로 다시 연결</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  브라우저 데이터를 지웠거나 다른 기기에서 들어올 때 사용해요. 다시 연결하면 원래
                  기기(브라우저)에서는 연결이 해제돼요.
                </p>
              </div>
              {!seats ? (
                <form onSubmit={loadSeats} className="flex flex-col gap-4">
                  <div>
                    <Label>초대 코드</Label>
                    <TextInput
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="받은 초대 코드를 입력"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      required
                      autoFocus
                    />
                  </div>
                  {error && <ErrorText>{error}</ErrorText>}
                  <Button type="submit" variant="primary" disabled={busy || !code.trim()} className="py-2.5">
                    {busy ? <Spinner /> : "멤버 목록 보기"}
                  </Button>
                </form>
              ) : (
                <div className="flex flex-col gap-3">
                  <Label>내 닉네임 선택</Label>
                  <div className="flex flex-col gap-2">
                    {seats.map((s) => (
                      <button
                        key={s.nickname}
                        type="button"
                        onClick={() => setPicked(s.nickname)}
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                          picked === s.nickname
                            ? "border-accent/70 bg-accent/10"
                            : "border-line bg-bg hover:bg-hover"
                        }`}
                      >
                        <span className="size-2.5 rounded-full" style={{ background: memberColor(s.slot) }} />
                        <span style={{ color: memberColor(s.slot) }} className="font-medium">
                          {s.nickname}
                        </span>
                      </button>
                    ))}
                  </div>
                  {error && <ErrorText>{error}</ErrorText>}
                  <Button
                    variant="primary"
                    disabled={busy || !picked}
                    onClick={() => void reclaim()}
                    className="py-2.5"
                  >
                    {busy ? <Spinner /> : picked ? `'${picked}'(으)로 다시 연결하기` : "닉네임을 골라 주세요"}
                  </Button>
                </div>
              )}
              <p className="rounded-lg border border-line bg-bg px-3 py-2.5 text-xs leading-relaxed text-muted">
                ⚠️ 초대 코드를 아는 사람은 누구의 닉네임이든 가져갈 수 있어요. 친구끼리 쓰는 방이라
                허용하고 있으니, 꼭 본인 닉네임을 골라 주세요.
              </p>
              <Button variant="ghost" onClick={() => { setError(null); setMode("join"); }}>
                새로 입장하기로 돌아가기
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent-hover">
      {children}
    </p>
  );
}
