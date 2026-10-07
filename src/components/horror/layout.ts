/**
 * 맵 배치와 충돌 판정. 복도는 z = 0 에서 -LENGTH 까지 뻗어 있고, 양옆 벽에 병실 문이 있다.
 * 단위는 m, 렌더링(Level)과 이동 판정(Player)이 같은 값을 쓴다.
 */

export const HALF_WIDTH = 1.5;
export const LENGTH = 48;
export const HEIGHT = 3;
export const EYE_HEIGHT = 1.6;
export const PLAYER_RADIUS = 0.28;
export const START_Z = -1.5;
/** 복도 끝 문에 이만큼까지 다가갈 수 있다 */
export const END_GAP = 0.8;

/** 천장 전등 위치 (z) */
export const LAMPS = [-6, -15, -24, -33, -42] as const;

export const DOOR_WIDTH = 1.1;
export const DOOR_HEIGHT = 2.1;
/** 문이 방 안쪽으로 열리는 각도 (rad) */
export const DOOR_OPEN_ANGLE = 1.45;
/** 병실 크기: 복도에서 안쪽으로 ROOM_DEPTH, 복도 방향으로 ROOM_WIDTH */
export const ROOM_DEPTH = 3.4;
export const ROOM_WIDTH = 4;
/** E 로 상호작용할 수 있는 거리 */
export const REACH = 2.2;

/** 상호작용 대상 번호: 0 부터는 ROOM_DOORS 순서, 복도 끝 문은 END_DOOR */
export const END_DOOR = -1;

export interface RoomDoor {
  /** -1 왼쪽 벽, 1 오른쪽 벽 */
  side: -1 | 1;
  z: number;
  label: string;
  locked?: boolean;
}

export const ROOM_DOORS: readonly RoomDoor[] = [
  { side: -1, z: -8, label: "B301" },
  { side: 1, z: -14, label: "B302" },
  { side: -1, z: -20, label: "B303" },
  { side: 1, z: -26, label: "B304", locked: true },
  { side: -1, z: -32, label: "B305" },
  { side: 1, z: -38, label: "B306" },
];

/** 시드 고정 난수: 렌더 중에 Math.random 을 쓰지 않으려고 */
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 영역

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const rect = (xa: number, xb: number, za: number, zb: number): Rect => ({
  x0: Math.min(xa, xb),
  x1: Math.max(xa, xb),
  z0: Math.min(za, zb),
  z1: Math.max(za, zb),
});

const expand = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });

const inside = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export type PropKind = "bed" | "cabinet" | "chair";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** 소품 모델의 로컬 +x 방향 */
  rotY: number;
}

export interface Room {
  index: number;
  door: RoomDoor;
  /** 방 가운데 */
  cx: number;
  cz: number;
  /** 플레이어 중심이 있을 수 있는 곳 (반지름만큼 안쪽) */
  walk: Rect;
  /** 문이 열려 있을 때만 지나갈 수 있는 문틀 */
  doorway: Rect;
  /** 문짝이 쓸고 지나가는 곳. 여기 서 있으면 문을 닫지 않는다 */
  sweep: Rect;
  obstacles: Rect[];
  props: Prop[];
  /** 안쪽 벽 창문의 z */
  windowZ: number;
}

const R = PLAYER_RADIUS;

export const ROOMS: readonly Room[] = (() => {
  const rand = seeded(42);
  return ROOM_DOORS.map((door, index) => {
    const { side, z: cz } = door;
    const cx = side * (HALF_WIDTH + ROOM_DEPTH / 2);
    // 방 안 좌표 u: 복도에서 멀어지는 쪽 (+), v: z 방향
    const wx = (u: number) => cx + side * u;
    // 소품 모델의 로컬 +x 가 복도에서 멀어지는 쪽을 보게
    const away = side > 0 ? 0 : Math.PI;

    const bedSide = rand() < 0.5 ? -1 : 1;
    const bedU = ROOM_DEPTH / 2 - 1.05;
    const bedV = bedSide * 1.15;
    const cabU = ROOM_DEPTH / 2 - 0.3;
    const cabV = -bedSide * 1.45;

    return {
      index,
      door,
      cx,
      cz,
      walk: expand(rect(wx(-ROOM_DEPTH / 2), wx(ROOM_DEPTH / 2), cz - ROOM_WIDTH / 2, cz + ROOM_WIDTH / 2), -R),
      doorway: rect(
        side * (HALF_WIDTH - R - 0.02),
        side * (HALF_WIDTH + R + 0.02),
        cz - DOOR_WIDTH / 2 + R,
        cz + DOOR_WIDTH / 2 - R,
      ),
      sweep: rect(
        side * (HALF_WIDTH - R),
        side * (HALF_WIDTH + DOOR_WIDTH + R),
        cz - DOOR_WIDTH / 2 - R,
        cz + DOOR_WIDTH / 2 + R,
      ),
      obstacles: [
        expand(rect(wx(bedU - 1), wx(bedU + 1), cz + bedV - 0.48, cz + bedV + 0.48), R),
        expand(rect(wx(cabU - 0.23), wx(cabU + 0.23), cz + cabV - 0.25, cz + cabV + 0.25), R),
      ],
      props: [
        { kind: "bed", x: wx(bedU), z: cz + bedV, rotY: away },
        // 서랍장 앞면은 방 안을 본다
        { kind: "cabinet", x: wx(cabU), z: cz + cabV, rotY: away + Math.PI },
        {
          kind: "chair",
          x: wx(-0.1 + rand() * 0.6),
          z: cz - bedSide * (0.55 + rand() * 0.35),
          rotY: rand() * Math.PI * 2,
        },
      ],
      windowZ: cz - bedSide * 0.35,
    };
  });
})();

const CORRIDOR = rect(-HALF_WIDTH + R, HALF_WIDTH - R, -LENGTH + END_GAP, -R);

/** 플레이어 중심이 (x, z) 에 설 수 있는지. 닫힌 문틀은 지나갈 수 없다 */
export function canStand(doorOpen: readonly boolean[], x: number, z: number) {
  for (const room of ROOMS) {
    if (room.obstacles.some((o) => inside(o, x, z))) return false;
  }
  if (inside(CORRIDOR, x, z)) return true;
  return ROOMS.some((r) => inside(r.walk, x, z) || (doorOpen[r.index] && inside(r.doorway, x, z)));
}

export const blocksDoor = (index: number, x: number, z: number) => inside(ROOMS[index].sweep, x, z);

export const inCorridor = (x: number) => Math.abs(x) < HALF_WIDTH;
