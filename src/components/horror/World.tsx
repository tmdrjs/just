"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { ENTITY_EYE_HEIGHT, Entity } from "./Entity";
import {
  blocksDoor,
  canStand,
  END_DOOR,
  ESCAPE_Z,
  EYE_HEIGHT,
  HALF_WIDTH,
  HEIGHT,
  inCorridor,
  ITEM_NAME,
  LAMPS,
  REACH,
  ROOM_DOORS,
  START_Z,
  type ItemId,
} from "./layout";
import { Level } from "./Level";
import type { CaughtReason, HorrorState, Interactable } from "./state";

const WALK_SPEED = 2.2;
const RUN_SPEED = 4.2;
const STEP_EVERY = 0.75;
const LAMP_INTENSITY = 7;
const FLASHLIGHT_INTENSITY = 7;

// 매 프레임 계산용 임시 값 (World 는 한 번에 하나만 뜬다)
const scratchDir = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchToEntity = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const SCREEN_CENTER = new THREE.Vector2(0, 0);

export interface WorldEvents {
  onMessage: (text: string, ms?: number) => void;
  /** 화면 가운데에 상호작용할 수 있는 것이 들어오거나 나감 (예: "문 열기") */
  onFocus: (label: string | null) => void;
  /** 가진 물건이 바뀜 */
  onItems: (items: ItemId[]) => void;
  onScare: () => void;
  onCaught: (reason: CaughtReason) => void;
  onEscape: () => void;
}

/** 3D 장면 전체. key 를 바꿔 다시 마운트하면 판이 처음부터 시작된다 */
export function World({ gameRef, events }: { gameRef: RefObject<HorrorState>; events: WorldEvents }) {
  const entityRef = useRef<THREE.Group>(null);
  return (
    <>
      <color attach="background" args={["#000"]} />
      <fog attach="fog" args={["#000", 2, 18]} />
      <ambientLight intensity={0.05} />
      <Level gameRef={gameRef} />
      <Lamps gameRef={gameRef} />
      <Flashlight gameRef={gameRef} />
      <Entity ref={entityRef} gameRef={gameRef} />
      <Player gameRef={gameRef} />
      <Interaction gameRef={gameRef} events={events} />
      <Director gameRef={gameRef} entityRef={entityRef} events={events} />
    </>
  );
}

// ---------------------------------------------------------------- 조명

function Lamps({ gameRef }: { gameRef: RefObject<HorrorState> }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const bulbs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useFrame(() => {
    const s = gameRef.current;
    LAMPS.forEach((_, i) => {
      const light = lights.current[i];
      const bulb = bulbs.current[i];
      if (!light || !bulb) return;
      let k = s.lampOn[i] ? 1 : 0;
      // 가끔 한 프레임씩 깜빡이고, 지정된 전등은 심하게 깜빡인다
      const chance = s.flickerLamp === i ? 0.45 : i === 1 ? 0.04 : 0.008;
      if (k && Math.random() < chance) k = 0.08 + Math.random() * 0.35;
      light.intensity = LAMP_INTENSITY * k;
      bulb.color.setRGB(k, k * 0.95, k * 0.82);
    });
  });

  return (
    <>
      {LAMPS.map((z, i) => (
        <group key={z} position={[0, HEIGHT, z]}>
          <mesh position={[0, -0.03, 0]}>
            <boxGeometry args={[0.7, 0.05, 0.22]} />
            <meshBasicMaterial
              ref={(m) => {
                bulbs.current[i] = m;
              }}
              color="#fff3d6"
            />
          </mesh>
          <pointLight
            ref={(l) => {
              lights.current[i] = l;
            }}
            position={[0, -0.25, 0]}
            color="#ffe2b0"
            intensity={LAMP_INTENSITY}
            distance={9}
            decay={1.6}
          />
        </group>
      ))}
    </>
  );
}

/** 카메라를 살짝 늦게 따라오는 손전등 */
function Flashlight({ gameRef }: { gameRef: RefObject<HorrorState> }) {
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const aim = useRef(new THREE.Vector3());

  useLayoutEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  useFrame(({ camera }, dt) => {
    const l = light.current;
    const t = target.current;
    if (!l || !t) return;
    const s = gameRef.current;
    const dir = camera.getWorldDirection(scratchDir);
    l.position.copy(camera.position).add(scratchOffset.set(0.18, -0.2, 0).applyQuaternion(camera.quaternion));
    aim.current.lerp(dir.multiplyScalar(6).add(camera.position), Math.min(1, dt * 14));
    t.position.copy(aim.current);
    let k = s.flashlight;
    if (s.flashFlicker > 0) {
      s.flashFlicker -= dt;
      if (Math.random() < 0.35) k *= Math.random() * 0.2;
    }
    l.intensity = FLASHLIGHT_INTENSITY * k;
  });

  return (
    <>
      <spotLight
        ref={light}
        color="#ffeacc"
        angle={0.42}
        penumbra={0.65}
        distance={18}
        decay={1.1}
        intensity={FLASHLIGHT_INTENSITY}
      />
      <object3D ref={target} />
    </>
  );
}

// ---------------------------------------------------------------- 플레이어

function Player({ gameRef }: { gameRef: RefObject<HorrorState> }) {
  const placed = useRef(false);
  const walked = useRef(0);
  const sinceStep = useRef(0);

  useFrame(({ camera }, delta) => {
    const s = gameRef.current;
    const dt = Math.min(delta, 0.05);
    // 다시 하기로 장면이 새로 마운트되면 출발점으로
    if (!placed.current) {
      placed.current = true;
      camera.position.set(0, EYE_HEIGHT, START_Z);
    }

    if (s.playing) {
      s.yaw -= s.look.x * s.look.sensitivity;
      s.pitch = THREE.MathUtils.clamp(s.pitch - s.look.y * s.look.sensitivity, -1.35, 1.35);
    }
    s.look.x = s.look.y = 0;

    const k = s.keys;
    const forward =
      (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + s.touchMove;
    const strafe = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? RUN_SPEED : WALK_SPEED;
    let moved = 0;
    if (s.playing && (forward || strafe)) {
      const sin = Math.sin(s.yaw);
      const cos = Math.cos(s.yaw);
      let dx = -sin * forward + cos * strafe;
      let dz = -cos * forward - sin * strafe;
      const len = Math.hypot(dx, dz) || 1;
      dx = (dx / len) * speed * dt;
      dz = (dz / len) * speed * dt;
      const p = camera.position;
      // 막히면 벽을 따라 미끄러진다 (x 만, z 만 차례로 시도)
      let x = p.x + dx;
      let z = p.z + dz;
      // 비상구는 문짝이 충분히 열려야 지나갈 수 있다
      const exitOpen = s.exitAngle > 1;
      if (!canStand(s.doorOpen, exitOpen, x, z)) {
        if (canStand(s.doorOpen, exitOpen, x, p.z)) z = p.z;
        else if (canStand(s.doorOpen, exitOpen, p.x, z)) x = p.x;
        else {
          x = p.x;
          z = p.z;
        }
      }
      moved = Math.hypot(x - p.x, z - p.z);
      p.x = x;
      p.z = z;
    }

    walked.current += moved;
    sinceStep.current += moved;
    if (sinceStep.current > STEP_EVERY * (speed === RUN_SPEED ? 1.3 : 1)) {
      sinceStep.current = 0;
      s.audio?.step();
    }

    // 걸을 때 머리가 살짝 흔들리고, 놀랐을 때 화면이 떨린다
    const bob = moved ? Math.sin(walked.current * 7) * 0.035 : 0;
    s.shake = Math.max(0, s.shake - dt * 1.4);
    const jitter = s.shake * 0.06;
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, EYE_HEIGHT + bob, 0.25);
    camera.rotation.set(
      s.pitch + (Math.random() - 0.5) * jitter,
      s.yaw + (Math.random() - 0.5) * jitter,
      (Math.random() - 0.5) * jitter * 0.5,
      "YXZ",
    );
  });

  return null;
}

// ---------------------------------------------------------------- 상호작용 (E)

/** 지금 이것에 E 를 누르면 무엇을 하는지. null 이면 할 수 있는 게 없다 */
function actionLabel(s: HorrorState, t: Interactable): string | null {
  if (t.type === "item") return s.items.has(t.item) ? null : `${ITEM_NAME[t.item]} 줍기`;
  if (t.door === END_DOOR) {
    if (s.exitUnlocked) return null;
    return s.items.has("exitKey") ? "열쇠로 열기" : "문 열기";
  }
  const key = ROOM_DOORS[t.door].key;
  if (key && !s.unlocked[t.door]) return s.items.has(key) ? "열쇠로 열기" : "문 열기";
  return s.doorOpen[t.door] ? "문 닫기" : "문 열기";
}

/** 화면 가운데로 광선을 쏴서 손이 닿는 문·물건을 찾고, E 를 누르면 쓴다 */
function Interaction({ gameRef, events }: { gameRef: RefObject<HorrorState>; events: WorldEvents }) {
  const shown = useRef<string | null>(null);
  const triedExit = useRef(false);

  useFrame(({ camera }) => {
    const s = gameRef.current;
    let target: Interactable | null = null;
    let label: string | null = null;
    if (s.playing) {
      raycaster.setFromCamera(SCREEN_CENTER, camera);
      raycaster.far = REACH;
      // 이미 주운 열쇠처럼 할 게 없는 것은 건너뛰고 가장 가까운 것
      for (const hit of raycaster.intersectObjects(s.targets, false)) {
        const t = hit.object.userData.interact as Interactable;
        const l = actionLabel(s, t);
        if (l) {
          target = t;
          label = l;
          break;
        }
      }
    }
    if (label !== shown.current) {
      shown.current = label;
      events.onFocus(label);
    }

    if (!s.interact) return;
    s.interact = false;
    if (!target) return;
    const { x, z } = camera.position;

    if (target.type === "item") {
      s.items.add(target.item);
      events.onItems([...s.items]);
      s.audio?.pickup();
      events.onMessage(`${ITEM_NAME[target.item]}를 주웠다.`, 2500);
      if (target.item === "exitKey") {
        // 줍는 순간 등 뒤에서 방문이 쾅 닫힌다
        const room = ROOM_DOORS.findIndex((d) => d.key === "roomKey");
        if (s.doorOpen[room] && !blocksDoor(room, x, z)) {
          s.doorOpen[room] = false;
          s.slamDoor = room;
        }
        s.flashFlicker = 1.6;
        s.audio?.whisper(0);
      }
      return;
    }

    const id = target.door;
    if (id === END_DOOR) {
      if (s.items.has("exitKey")) {
        // 잠금만 풀고, 문이 열리는 건 연출(Director)이 맡는다
        s.exitUnlocked = true;
        s.audio?.unlock();
        events.onMessage("열쇠가 돌아간다…", 2500);
      } else {
        s.audio?.rattle();
        events.onMessage(triedExit.current ? "잠겨 있다." : "잠겨 있다. 열쇠가 필요하다…", 2500);
        triedExit.current = true;
      }
      return;
    }
    const key = ROOM_DOORS[id].key;
    if (key && !s.unlocked[id]) {
      if (s.items.has(key)) {
        s.unlocked[id] = true;
        s.doorOpen[id] = true;
        s.audio?.unlock();
        s.audio?.creak();
        events.onMessage("열쇠가 맞는다.", 2000);
      } else {
        s.audio?.rattle();
        events.onMessage("잠겨 있다.", 2000);
      }
      return;
    }
    if (s.doorOpen[id]) {
      // 문짝이 지나갈 자리에 서 있으면 닫지 않는다
      if (blocksDoor(id, x, z)) return;
      s.doorOpen[id] = false;
      s.audio?.creak(0.5);
    } else {
      s.doorOpen[id] = true;
      s.audio?.creak();
    }
  });

  return null;
}

// ---------------------------------------------------------------- 연출

type Stage =
  | "walk"
  | "glimpse"
  | "afterGlimpse"
  | "blackout"
  | "explore"
  | "door"
  | "behind"
  | "seen"
  | "scare"
  | "done";

/** 비상구를 연 뒤의 단계들 (이 동안에는 앞 단계 이벤트가 끼어들지 않는다) */
const ENDING_STAGES: ReadonlySet<Stage> = new Set(["door", "behind", "seen", "scare", "done"]);

/**
 * 플레이어 위치와 행동에 따라 이벤트를 차례로 일으킨다.
 * 비상구 열쇠로 문을 열면 언제든 엔딩: 등 뒤에 엔티티가 서고, 돌아보지 않고 계단실로 나가면 탈출
 */
function Director({
  gameRef,
  entityRef,
  events,
}: {
  gameRef: RefObject<HorrorState>;
  entityRef: RefObject<THREE.Group | null>;
  events: WorldEvents;
}) {
  const stage = useRef<Stage>("walk");
  const timer = useRef(0);
  const step = useRef(0);
  const reason = useRef<CaughtReason>("waited");

  const go = (next: Stage, seconds = 0) => {
    stage.current = next;
    timer.current = seconds;
    step.current = 0;
  };

  useFrame(({ camera }, delta) => {
    const s = gameRef.current;
    const e = entityRef.current;
    if (!e || (!s.playing && stage.current !== "scare")) return;
    const dt = Math.min(delta, 0.05);
    timer.current -= dt;
    const { x, z } = camera.position;
    const dir = camera.getWorldDirection(scratchDir);
    dir.y = 0;
    dir.normalize();
    const toEntity = scratchToEntity.set(e.position.x - x, 0, e.position.z - z).normalize();
    if (s.exitUnlocked && !ENDING_STAGES.has(stage.current)) {
      e.visible = false;
      s.flickerLamp = null;
      go("door", 0.9);
    }

    const faceCamera = () => e.lookAt(x, e.position.y, z);
    const scare = () => {
      e.visible = true;
      if (reason.current === "waited") {
        // 끝까지 안 돌아보면 앞쪽 어둠에서 나타난다
        e.position.set(x + dir.x, 0, z + dir.z);
      }
      s.entityPose = "reach";
      s.flashlight = 1;
      s.shake = 1;
      s.audio?.scream();
      events.onScare();
      go("scare", 1.1);
    };

    switch (stage.current) {
      case "walk":
        // 복도에서 앞을 보고 있을 때, 저 멀리 전등 아래 누군가 서 있다
        if (z < -21 && inCorridor(x) && dir.z < -0.7) {
          e.position.set(0.35, 0, -31.8);
          faceCamera();
          e.visible = true;
          s.entityPose = "idle";
          s.flickerLamp = 3;
          s.audio?.stinger();
          go("glimpse", 1.6);
        }
        break;
      case "glimpse":
        if (timer.current < 0) {
          e.visible = false;
          s.flickerLamp = null;
          s.lampOn[3] = false;
          s.audio?.clunk();
          events.onMessage("…방금 저 끝에 누가 서 있었나?", 3000);
          go("afterGlimpse");
        }
        break;
      case "afterGlimpse":
        if (z < -29) go("blackout", 0);
        break;
      case "blackout":
        // 뒤쪽 전등부터 하나씩 꺼진다
        if (timer.current < 0) {
          const i = step.current++;
          if (i < 3) {
            if (s.lampOn[i]) {
              s.lampOn[i] = false;
              s.audio?.clunk();
            }
            timer.current = 0.45;
          } else {
            s.flickerLamp = 4;
            go("explore");
          }
        }
        break;
      case "explore":
        break;
      case "door":
        if (timer.current < 0) {
          // 남은 전등이 모두 꺼지고, 비상구가 천천히 열리기 시작하고, 등 뒤에 선다
          s.lampOn = s.lampOn.map(() => false);
          s.flickerLamp = null;
          s.audio?.clunk();
          s.exitOpen = true;
          s.audio?.creak(2.8);
          e.position.set(THREE.MathUtils.clamp(x, -HALF_WIDTH + 0.35, HALF_WIDTH - 0.35), 0, z + 1.4);
          faceCamera();
          e.visible = true;
          s.entityPose = "idle";
          // 엔티티가 있는 쪽 귀에서 속삭인다 (카메라 오른쪽 = (cos yaw, 0, -sin yaw))
          toEntity.set(e.position.x - x, 0, e.position.z - z).normalize();
          s.audio?.whisper(Math.cos(s.yaw) * toEntity.x - Math.sin(s.yaw) * toEntity.z);
          go("behind", 12);
        }
        break;
      case "behind": {
        // 돌아보지 않고 비상구를 지나면 탈출
        if (z < ESCAPE_Z) {
          e.visible = false;
          go("done");
          events.onEscape();
          break;
        }
        // 등 뒤에서 아주 천천히 다가온다
        s.flashlight = Math.random() < 0.06 ? 0.15 : 1;
        if (Math.hypot(e.position.x - x, e.position.z - z) > 0.95) {
          e.position.x -= toEntity.x * dt * 0.15;
          e.position.z -= toEntity.z * dt * 0.15;
        }
        faceCamera();
        const facing = dir.dot(toEntity) > 0.55;
        if (facing) {
          // 돌아본 순간 잠깐 마주 본다
          reason.current = "turned";
          s.flashlight = 1;
          go("seen", 0.45);
        } else if (timer.current < 0) {
          reason.current = "waited";
          scare();
        }
        break;
      }
      case "seen":
        faceCamera();
        if (timer.current < 0) scare();
        break;
      case "scare":
        // 얼굴 앞으로 달려든다
        e.position.lerp(
          toEntity.set(x + dir.x * 0.55, EYE_HEIGHT - ENTITY_EYE_HEIGHT, z + dir.z * 0.55),
          Math.min(1, dt * 18),
        );
        faceCamera();
        if (timer.current < 0) {
          go("done");
          events.onCaught(reason.current);
        }
        break;
    }
  });

  return null;
}
