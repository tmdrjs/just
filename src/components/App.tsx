"use client";

import { useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { Button, Spinner } from "./ui/Button";
import { EntryScreen } from "./EntryScreen";
import { Room } from "./room/Room";
import { Turnstile } from "./Turnstile";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Phase =
  | { kind: "booting" }
  | { kind: "captcha" }
  | { kind: "error"; message: string }
  | { kind: "entry"; userId: string; notice?: string }
  | { kind: "room"; userId: string };

function describeAuthError(message: string) {
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return "Supabase에서 익명 로그인(Anonymous Sign-ins)이 꺼져 있어요. 대시보드 Authentication > Sign In / Providers 에서 켜 주세요.";
  }
  if (/captcha/i.test(message)) return "CAPTCHA 확인에 실패했어요. 새로고침 후 다시 시도해 주세요.";
  return `접속 준비 중 오류가 발생했어요: ${message}`;
}

async function phaseForUser(userId: string): Promise<Phase> {
  const { data, error } = await getSupabase().rpc("is_member");
  if (error) return { kind: "error", message: `서버에 연결하지 못했어요: ${error.message}` };
  return data ? { kind: "room", userId } : { kind: "entry", userId };
}

async function signInAndRoute(captchaToken?: string): Promise<Phase> {
  const { data, error } = await getSupabase().auth.signInAnonymously(
    captchaToken ? { options: { captchaToken } } : undefined,
  );
  if (error || !data.user) {
    return { kind: "error", message: describeAuthError(error?.message ?? "unknown") };
  }
  return phaseForUser(data.user.id);
}

async function resolveBoot(): Promise<Phase> {
  // 같은 브라우저로 재방문하면 저장된 익명 세션을 그대로 쓴다
  const { data } = await getSupabase().auth.getSession();
  if (data.session?.user) return phaseForUser(data.session.user.id);
  if (TURNSTILE_SITE_KEY) return { kind: "captcha" };
  return signInAndRoute();
}

// 개발 모드에서 effect가 두 번 실행돼도 익명 로그인은 한 번만 하도록 공유
let bootPromise: Promise<Phase> | null = null;
function bootOnce() {
  bootPromise ??= resolveBoot().catch(
    (e: unknown): Phase => ({ kind: "error", message: `접속 준비 중 오류가 발생했어요: ${String(e)}` }),
  );
  return bootPromise;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "booting" });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void bootOnce().then((next) => {
      if (!cancelled) setPhase(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const retry = () => {
    bootPromise = null;
    setPhase({ kind: "booting" });
    void bootOnce().then(setPhase);
  };

  if (!isSupabaseConfigured) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">설정이 필요해요</h1>
        <p className="text-sm text-sub">
          <code className="rounded bg-elev px-1">.env.local</code> 에{" "}
          <code className="rounded bg-elev px-1">NEXT_PUBLIC_SUPABASE_URL</code> 과{" "}
          <code className="rounded bg-elev px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> 를 넣고
          다시 실행해 주세요. (README 참고)
        </p>
      </Centered>
    );
  }

  switch (phase.kind) {
    case "booting":
      return (
        <Centered>
          <Spinner className="size-6 text-accent" />
        </Centered>
      );
    case "captcha":
      return (
        <Centered>
          <p className="text-sm text-sub">사람인지 확인하고 있어요…</p>
          <Turnstile siteKey={TURNSTILE_SITE_KEY!} onToken={(t) => void signInAndRoute(t).then(setPhase)} />
        </Centered>
      );
    case "error":
      return (
        <Centered>
          <p className="text-sm text-sub">{phase.message}</p>
          <Button variant="secondary" onClick={retry}>
            다시 시도
          </Button>
        </Centered>
      );
    case "entry":
      return (
        <EntryScreen
          notice={phase.notice}
          onJoined={() => setPhase({ kind: "room", userId: phase.userId })}
        />
      );
    case "room":
      return (
        <Room
          key={phase.userId}
          userId={phase.userId}
          onExit={(notice) => setPhase({ kind: "entry", userId: phase.userId, notice })}
        />
      );
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">{children}</div>
    </main>
  );
}
