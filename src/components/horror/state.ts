import type { HorrorAudio } from "./audio";

/** 복도 크기 (m). 플레이어는 z = 0 쪽에서 출발해 -z 방향 끝의 문으로 간다 */
export const HALF_WIDTH = 1.5;
export const LENGTH = 48;
export const HEIGHT = 3;
export const EYE_HEIGHT = 1.6;
export const PLAYER_RADIUS = 0.3;
export const START_Z = -1.5;

/** 천장 전등 위치 (z) */
export const LAMPS = [-6, -15, -24, -33, -42] as const;

export type Phase = "intro" | "playing" | "paused" | "caught";
export type CaughtReason = "turned" | "waited";

/**
 * 매 프레임 바뀌는 값은 React 상태가 아니라 이 객체에 두고 직접 고친다 (리렌더 없이 60fps).
 * 화면 전환(시작·일시정지·잡힘)만 React 상태로 다룬다.
 */
export interface HorrorState {
  playing: boolean;
  /** 누르고 있는 키 (KeyboardEvent.code. 한글 자판이어도 같은 값) */
  keys: Set<string>;
  /** 다음 프레임에 반영할 시점 이동량 (px) */
  look: { x: number; y: number; sensitivity: number };
  /** 터치 "걷기" 버튼: 1 앞으로, -1 뒤로 */
  touchMove: number;
  yaw: number;
  pitch: number;
  lampOn: boolean[];
  /** 심하게 깜빡이는 전등 번호 */
  flickerLamp: number | null;
  /** 손전등 밝기 배율 0~1 */
  flashlight: number;
  /** 화면 흔들림 세기 (점점 줄어듦) */
  shake: number;
  muted: boolean;
  audio: HorrorAudio | null;
}

export function createHorrorState(): HorrorState {
  return {
    playing: false,
    keys: new Set(),
    look: { x: 0, y: 0, sensitivity: 0 },
    touchMove: 0,
    yaw: 0,
    pitch: 0,
    lampOn: LAMPS.map(() => true),
    flickerLamp: null,
    flashlight: 1,
    shake: 0,
    muted: false,
    audio: null,
  };
}

/** 다시 하기: 소리·음소거 설정은 두고 판만 처음으로 */
export function resetRun(s: HorrorState) {
  s.keys.clear();
  s.look.x = s.look.y = 0;
  s.touchMove = 0;
  s.yaw = s.pitch = 0;
  s.lampOn = LAMPS.map(() => true);
  s.flickerLamp = null;
  s.flashlight = 1;
  s.shake = 0;
}
