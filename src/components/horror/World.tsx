"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import {
  EYE_HEIGHT,
  HALF_WIDTH,
  HEIGHT,
  LAMPS,
  LENGTH,
  PLAYER_RADIUS,
  START_Z,
  type CaughtReason,
  type HorrorState,
} from "./state";

const WALK_SPEED = 2.2;
const RUN_SPEED = 4.2;
const STEP_EVERY = 0.75;
const LAMP_INTENSITY = 7;
const FLASHLIGHT_INTENSITY = 7;

// 매 프레임 계산용 임시 벡터 (World 는 한 번에 하나만 뜬다)
const scratchDir = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchToGhost = new THREE.Vector3();

/** 시드 고정 난수: 렌더 중에 Math.random 을 쓰지 않으려고 */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WorldEvents {
  onMessage: (text: string, ms?: number) => void;
  onScare: () => void;
  onCaught: (reason: CaughtReason) => void;
}

/** 3D 장면 전체. key 를 바꿔 다시 마운트하면 판이 처음부터 시작된다 */
export function World({ gameRef, events }: { gameRef: RefObject<HorrorState>; events: WorldEvents }) {
  const ghostRef = useRef<THREE.Group>(null);
  return (
    <>
      <color attach="background" args={["#000"]} />
      <fog attach="fog" args={["#000", 2, 18]} />
      <ambientLight intensity={0.05} />
      <Corridor />
      <Lamps gameRef={gameRef} />
      <Flashlight gameRef={gameRef} />
      <Ghost ref={ghostRef} />
      <Player gameRef={gameRef} />
      <Director gameRef={gameRef} ghostRef={ghostRef} events={events} />
    </>
  );
}

// ---------------------------------------------------------------- 텍스처

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function grain(g: CanvasRenderingContext2D, amount: number) {
  const { width, height } = g.canvas;
  const img = g.getImageData(0, 0, width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function stains(g: CanvasRenderingContext2D, count: number, color: string) {
  const { width, height } = g.canvas;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = 8 + Math.random() * 46;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** 병원 복도 느낌: 위는 바랜 회녹색, 아래 1/3 은 짙은 갈색 징두리 */
const wallTexture = () =>
  canvasTexture(256, 256, (g) => {
    g.fillStyle = "#6f746a";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#3b2f27";
    g.fillRect(0, 175, 256, 81);
    g.fillStyle = "#2a221c";
    g.fillRect(0, 171, 256, 5);
    stains(g, 18, "rgba(30,24,16,0.45)");
    // 흘러내린 자국
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * 256;
      const len = 30 + Math.random() * 120;
      const grad = g.createLinearGradient(0, 0, 0, len);
      grad.addColorStop(0, "rgba(40,28,18,0.5)");
      grad.addColorStop(1, "rgba(40,28,18,0)");
      g.fillStyle = grad;
      g.fillRect(x, 0, 2 + Math.random() * 3, len);
    }
    grain(g, 22);
  });

const floorTexture = () =>
  canvasTexture(256, 256, (g) => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        g.fillStyle = (x + y) % 2 ? "#4d4a44" : "#75716a";
        g.fillRect(x * 128, y * 128, 128, 128);
      }
    }
    stains(g, 14, "rgba(20,14,10,0.5)");
    grain(g, 26);
  });

const ceilingTexture = () =>
  canvasTexture(128, 128, (g) => {
    g.fillStyle = "#4a4a46";
    g.fillRect(0, 0, 128, 128);
    stains(g, 8, "rgba(35,28,18,0.5)");
    grain(g, 20);
  });

/** 패널 두 칸짜리 낡은 나무 문. scratches: 손톱 자국 */
const doorTexture = (base: string, scratches = false) =>
  canvasTexture(128, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 256);
    g.globalAlpha = 0.06;
    for (let x = 0; x < 128; x += 3 + Math.random() * 5) {
      g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff";
      g.fillRect(x, 0, 1, 256);
    }
    g.globalAlpha = 1;
    for (const [y, h] of [
      [100, 60],
      [176, 62],
    ]) {
      g.strokeStyle = "rgba(0,0,0,0.55)";
      g.lineWidth = 4;
      g.strokeRect(20, y, 88, h);
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.lineWidth = 1;
      g.strokeRect(23, y + 3, 82, h - 6);
    }
    stains(g, 6, "rgba(0,0,0,0.4)");
    if (scratches) {
      g.strokeStyle = "rgba(220,200,190,0.35)";
      g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const x = 30 + Math.random() * 60;
        g.beginPath();
        g.moveTo(x, 120 + Math.random() * 20);
        g.lineTo(x + (Math.random() - 0.5) * 12, 200 + Math.random() * 40);
        g.stroke();
      }
    }
    grain(g, 18);
  });

const writingTexture = () =>
  canvasTexture(1024, 256, (g) => {
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = "rgba(120,6,10,0.92)";
    g.font = "bold 150px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
    g.textBaseline = "middle";
    const text = "뒤돌아보지마";
    let x = 40;
    for (const ch of text) {
      g.save();
      g.translate(x, 128 + (Math.random() - 0.5) * 30);
      g.rotate((Math.random() - 0.5) * 0.2);
      g.fillText(ch, 0, 0);
      g.restore();
      x += 155;
    }
    // 흘러내림
    for (let i = 0; i < 10; i++) {
      g.fillRect(60 + Math.random() * 900, 170, 3, 20 + Math.random() * 70);
    }
  });

// ---------------------------------------------------------------- 복도

function Corridor() {
  const tex = useMemo(() => {
    const wall = wallTexture();
    wall.repeat.set(LENGTH / 3, 1);
    const floor = floorTexture();
    floor.repeat.set(HALF_WIDTH * 2, LENGTH);
    const ceiling = ceilingTexture();
    ceiling.repeat.set(HALF_WIDTH, LENGTH / 2);
    const endWall = wallTexture();
    endWall.repeat.set(1, 1);
    return {
      wall,
      floor,
      ceiling,
      endWall,
      writing: writingTexture(),
      door: doorTexture("#3a2a1f"),
      endDoor: doorTexture("#4a1414", true),
    };
  }, []);
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);

  const papers = useMemo(() => {
    const rand = seeded(13);
    return Array.from({ length: 9 }, () => ({
      x: (rand() - 0.5) * (HALF_WIDTH * 2 - 0.4),
      z: -4 - rand() * (LENGTH - 8),
      r: rand() * Math.PI,
    }));
  }, []);

  const mid = -LENGTH / 2;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, mid]}>
        <planeGeometry args={[HALF_WIDTH * 2, LENGTH]} />
        <meshStandardMaterial map={tex.floor} roughness={0.7} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, HEIGHT, mid]}>
        <planeGeometry args={[HALF_WIDTH * 2, LENGTH]} />
        <meshStandardMaterial map={tex.ceiling} roughness={1} />
      </mesh>
      <mesh rotation-y={Math.PI / 2} position={[-HALF_WIDTH, HEIGHT / 2, mid]}>
        <planeGeometry args={[LENGTH, HEIGHT]} />
        <meshStandardMaterial map={tex.wall} roughness={0.95} />
      </mesh>
      <mesh rotation-y={-Math.PI / 2} position={[HALF_WIDTH, HEIGHT / 2, mid]}>
        <planeGeometry args={[LENGTH, HEIGHT]} />
        <meshStandardMaterial map={tex.wall} roughness={0.95} />
      </mesh>
      <mesh position={[0, HEIGHT / 2, -LENGTH]}>
        <planeGeometry args={[HALF_WIDTH * 2, HEIGHT]} />
        <meshStandardMaterial map={tex.endWall} roughness={0.95} />
      </mesh>
      <mesh rotation-y={Math.PI} position={[0, HEIGHT / 2, 0]}>
        <planeGeometry args={[HALF_WIDTH * 2, HEIGHT]} />
        <meshStandardMaterial map={tex.endWall} roughness={0.95} />
      </mesh>

      {/* 양옆 병실 문 */}
      {[-9, -18, -27, -36].map((z, i) => (
        <Door key={z} map={tex.door} position={[i % 2 ? HALF_WIDTH - 0.03 : -HALF_WIDTH + 0.03, 0, z]} side />
      ))}
      {[-12, -30].map((z, i) => (
        <Door key={z} map={tex.door} position={[i % 2 ? -HALF_WIDTH + 0.03 : HALF_WIDTH - 0.03, 0, z]} side />
      ))}
      {/* 복도 끝, 잠긴 문 */}
      <Door map={tex.endDoor} position={[0, 0, -LENGTH + 0.04]} />

      {/* 벽의 낙서 */}
      <mesh rotation-y={-Math.PI / 2} position={[HALF_WIDTH - 0.01, 1.6, -39.5]}>
        <planeGeometry args={[3.2, 0.8]} />
        <meshStandardMaterial map={tex.writing} transparent roughness={0.6} />
      </mesh>

      {papers.map((p, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, p.r]} position={[p.x, 0.005, p.z]}>
          <planeGeometry args={[0.21, 0.29]} />
          <meshStandardMaterial color="#9c988c" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Door({
  position,
  map,
  side = false,
}: {
  position: [number, number, number];
  map: THREE.Texture;
  side?: boolean;
}) {
  // side: 옆벽에 붙은 문 (복도 쪽을 보도록 90도 회전)
  const facing = side ? (position[0] > 0 ? -Math.PI / 2 : Math.PI / 2) : 0;
  return (
    <group position={position} rotation-y={facing}>
      <mesh position={[0, 1.05, 0]}>
        <boxGeometry args={[1, 2.1, 0.06]} />
        <meshStandardMaterial map={map} roughness={0.85} />
      </mesh>
      <mesh position={[0.36, 1.0, 0.05]}>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshStandardMaterial color="#8a7f6a" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* 문 위 작은 창 */}
      <mesh position={[0, 1.75, 0.035]}>
        <planeGeometry args={[0.4, 0.25]} />
        <meshStandardMaterial color="#050607" roughness={0.2} metalness={0.4} />
      </mesh>
    </group>
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
    const dir = camera.getWorldDirection(scratchDir);
    l.position.copy(camera.position).add(scratchOffset.set(0.18, -0.2, 0).applyQuaternion(camera.quaternion));
    aim.current.lerp(dir.multiplyScalar(6).add(camera.position), Math.min(1, dt * 14));
    t.position.copy(aim.current);
    l.intensity = FLASHLIGHT_INTENSITY * gameRef.current.flashlight;
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

// ---------------------------------------------------------------- 귀신

/** 키 2m 의 마른 그림자. 빛을 받지 않는 새까만 재질이라 밝은 곳을 가릴 때만 윤곽이 보인다. 얼굴(+z)이 lookAt 대상 쪽을 본다 */
function Ghost({ ref }: { ref: RefObject<THREE.Group | null> }) {
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g?.visible) return;
    g.children[0].rotation.z = Math.sin(clock.elapsedTime * 7) * 0.03;
  });

  return (
    <group ref={ref} visible={false}>
      <group>
        <mesh position={[0, 1.0, 0]}>
          <capsuleGeometry args={[0.22, 1.1, 4, 10]} />
          <meshBasicMaterial color="#000" />
        </mesh>
        <mesh position={[0, 1.86, 0.02]} scale={[1, 1.25, 1]}>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshBasicMaterial color="#000" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.31, 1.0, 0.02]} rotation-z={s * 0.07}>
            <capsuleGeometry args={[0.045, 1.0, 4, 6]} />
            <meshBasicMaterial color="#000" />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.06, 1.9, 0.165]}>
            <sphereGeometry args={[0.016, 8, 6]} />
            <meshBasicMaterial color="#ff1a1a" />
          </mesh>
        ))}
        {/* 길게 찢어진 입 */}
        <mesh position={[0, 1.79, 0.16]} scale={[1.5, 0.2, 0.3]}>
          <sphereGeometry args={[0.05, 12, 8]} />
          <meshBasicMaterial color="#5a0008" />
        </mesh>
      </group>
    </group>
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
      const x = THREE.MathUtils.clamp(p.x + dx, -HALF_WIDTH + PLAYER_RADIUS, HALF_WIDTH - PLAYER_RADIUS);
      const z = THREE.MathUtils.clamp(p.z + dz, -LENGTH + 0.8, -PLAYER_RADIUS);
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

// ---------------------------------------------------------------- 연출

type Stage = "walk" | "glimpse" | "afterGlimpse" | "blackout" | "toDoor" | "door" | "behind" | "scare" | "done";

/** 플레이어 위치에 따라 이벤트를 차례로 일으킨다 */
function Director({
  gameRef,
  ghostRef,
  events,
}: {
  gameRef: RefObject<HorrorState>;
  ghostRef: RefObject<THREE.Group | null>;
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
    const g = ghostRef.current;
    const dir = scratchDir;
    const toGhost = scratchToGhost;
    if (!g || (!s.playing && stage.current !== "scare")) return;
    const dt = Math.min(delta, 0.05);
    timer.current -= dt;
    const z = camera.position.z;
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();

    const scare = () => {
      g.visible = true;
      if (reason.current === "waited") {
        // 끝까지 안 돌아보면 앞쪽 어둠에서 나타난다
        g.position.set(camera.position.x + dir.x, 0, camera.position.z + dir.z);
      }
      s.shake = 1;
      s.audio?.scream();
      events.onScare();
      go("scare", 1.1);
    };

    switch (stage.current) {
      case "walk":
        if (z < -21) {
          // 저 멀리 전등 아래 누군가 서 있다
          g.position.set(0.35, 0, -31.8);
          g.lookAt(camera.position.x, 0, camera.position.z);
          g.visible = true;
          s.flickerLamp = 3;
          s.audio?.stinger();
          go("glimpse", 1.6);
        }
        break;
      case "glimpse":
        if (timer.current < 0) {
          g.visible = false;
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
            go("toDoor");
          }
        }
        break;
      case "toDoor":
        if (z < -LENGTH + 1.6) {
          s.audio?.rattle();
          events.onMessage("잠겨 있다.", 2200);
          go("door", 1.8);
        }
        break;
      case "door":
        if (timer.current < 0) {
          // 마지막 전등도 꺼지고, 등 뒤에 선다
          s.lampOn[4] = false;
          s.flickerLamp = null;
          s.audio?.clunk();
          g.position.set(
            THREE.MathUtils.clamp(camera.position.x, -HALF_WIDTH + 0.35, HALF_WIDTH - 0.35),
            0,
            camera.position.z + 1.3,
          );
          g.lookAt(camera.position.x, 0, camera.position.z);
          g.visible = true;
          // 귀신이 있는 쪽 귀에서 속삭인다 (카메라 오른쪽 = (cos yaw, 0, -sin yaw))
          toGhost.set(g.position.x - camera.position.x, 0, g.position.z - camera.position.z).normalize();
          s.audio?.whisper(Math.cos(s.yaw) * toGhost.x - Math.sin(s.yaw) * toGhost.z);
          go("behind", 9);
        }
        break;
      case "behind": {
        s.flashlight = Math.random() < 0.06 ? 0.15 : 1;
        toGhost.set(g.position.x - camera.position.x, 0, g.position.z - camera.position.z).normalize();
        const facing = dir.dot(toGhost) > 0.55;
        if (facing || timer.current < 0) {
          reason.current = facing ? "turned" : "waited";
          scare();
        }
        break;
      }
      case "scare":
        // 얼굴 앞으로 달려든다
        s.flashlight = 1;
        g.position.lerp(
          toGhost.set(camera.position.x + dir.x * 0.55, EYE_HEIGHT - 1.9, camera.position.z + dir.z * 0.55),
          Math.min(1, dt * 18),
        );
        g.lookAt(camera.position.x, g.position.y, camera.position.z);
        if (timer.current < 0) {
          go("done");
          events.onCaught(reason.current);
        }
        break;
    }
  });

  return null;
}
