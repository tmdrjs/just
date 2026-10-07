import type { Object3D } from "three";
import type { HorrorAudio } from "./audio";
import { LAMPS, ROOM_DOORS } from "./layout";

export type Phase = "intro" | "playing" | "paused" | "caught";
export type CaughtReason = "turned" | "waited";
export type EntityPose = "idle" | "reach";

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
  /** E 를 눌렀음. 다음 프레임에 상호작용하고 지운다 */
  interact: boolean;
  yaw: number;
  pitch: number;
  lampOn: boolean[];
  /** 심하게 깜빡이는 전등 번호 */
  flickerLamp: number | null;
  /** 손전등 밝기 배율 0~1 */
  flashlight: number;
  /** 화면 흔들림 세기 (점점 줄어듦) */
  shake: number;
  /** ROOM_DOORS 순서대로 문이 열려 있는지 */
  doorOpen: boolean[];
  /** 복도 끝 문을 열어 보려 했음 (연출이 확인하고 지운다) */
  endDoorTried: boolean;
  entityPose: EntityPose;
  /** E 로 상호작용할 수 있는 물체 (화면 가운데 광선이 닿는지 검사) */
  targets: Object3D[];
  muted: boolean;
  audio: HorrorAudio | null;
}

export function createHorrorState(): HorrorState {
  return {
    playing: false,
    keys: new Set(),
    look: { x: 0, y: 0, sensitivity: 0 },
    touchMove: 0,
    interact: false,
    yaw: 0,
    pitch: 0,
    lampOn: LAMPS.map(() => true),
    flickerLamp: null,
    flashlight: 1,
    shake: 0,
    doorOpen: ROOM_DOORS.map(() => false),
    endDoorTried: false,
    entityPose: "idle",
    targets: [],
    muted: false,
    audio: null,
  };
}

/** 다시 하기: 소리·음소거 설정은 두고 판만 처음으로 (targets 는 장면이 다시 마운트되며 갈아 끼운다) */
export function resetRun(s: HorrorState) {
  s.keys.clear();
  s.look.x = s.look.y = 0;
  s.touchMove = 0;
  s.interact = false;
  s.yaw = s.pitch = 0;
  s.lampOn = LAMPS.map(() => true);
  s.flickerLamp = null;
  s.flashlight = 1;
  s.shake = 0;
  s.doorOpen = ROOM_DOORS.map(() => false);
  s.endDoorTried = false;
  s.entityPose = "idle";
}
