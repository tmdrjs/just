"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import {
  DOOR_HEIGHT,
  DOOR_OPEN_ANGLE,
  DOOR_WIDTH,
  END_DOOR,
  HALF_WIDTH,
  HEIGHT,
  LENGTH,
  ROOM_DEPTH,
  ROOM_DOORS,
  ROOM_WIDTH,
  ROOMS,
  seeded,
  type Prop,
  type Room,
} from "./layout";
import type { HorrorState } from "./state";
import {
  ceilingTexture,
  doorTexture,
  floorTexture,
  mattressTexture,
  plateTexture,
  signTexture,
  wallTexture,
  writingTexture,
} from "./textures";

/** 텍스처 한 장이 덮는 크기 (m) */
const WALL_TILE = 3;
const FLOOR_TILE = 1;
const CEILING_TILE = 2;

/** 바닥·천장: UV 를 실제 크기에 맞춰 늘려서 텍스처가 늘어나지 않고 반복되게 */
function tiledPlane(width: number, height: number, tile: number) {
  const geo = new THREE.PlaneGeometry(width, height);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / tile, (uv.getY(i) * height) / tile);
  return geo;
}

/** 벽: 가로는 반복, 세로는 바닥에서의 높이를 따라 (아래쪽 징두리가 늘 바닥에 붙게) */
function wallPlane(width: number, height: number, bottom = 0) {
  const geo = new THREE.PlaneGeometry(width, height);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * width) / WALL_TILE, (bottom + uv.getY(i) * height) / HEIGHT);
  }
  return geo;
}

interface WallPiece {
  geo: THREE.BufferGeometry;
  position: [number, number, number];
  rotY: number;
}

/** 복도 양옆 벽을 문 자리만 비워 여러 조각으로 (문 위는 상인방 조각) */
function corridorWalls(): WallPiece[] {
  const pieces: WallPiece[] = [];
  for (const side of [-1, 1] as const) {
    // 벽 앞면이 복도 쪽을 보게
    const rotY = (-side * Math.PI) / 2;
    const add = (zTop: number, zBottom: number, height: number, bottom: number) => {
      const width = zTop - zBottom;
      if (width <= 0) return;
      pieces.push({
        geo: wallPlane(width, height, bottom),
        position: [side * HALF_WIDTH, bottom + height / 2, (zTop + zBottom) / 2],
        rotY,
      });
    };
    const openings = ROOM_DOORS.filter((d) => d.side === side)
      .map((d) => d.z)
      .sort((a, b) => b - a);
    let from = 0;
    for (const z of openings) {
      add(from, z + DOOR_WIDTH / 2, HEIGHT, 0);
      add(z + DOOR_WIDTH / 2, z - DOOR_WIDTH / 2, HEIGHT - DOOR_HEIGHT, DOOR_HEIGHT);
      from = z - DOOR_WIDTH / 2;
    }
    add(from, -LENGTH, HEIGHT, 0);
  }
  return pieces;
}

/** 복도 + 병실 + 문. 문은 gameRef.doorOpen 을 따라 열리고 닫힌다 */
export function Level({ gameRef }: { gameRef: RefObject<HorrorState> }) {
  const tex = useMemo(
    () => ({
      wall: wallTexture(),
      floor: floorTexture(),
      ceiling: ceilingTexture(),
      writing: writingTexture(),
      door: doorTexture("#3a2a1f"),
      endDoor: doorTexture("#4a1414", true),
      mattress: mattressTexture(),
      sign: signTexture(),
      plates: ROOM_DOORS.map((d) => plateTexture(d.label)),
    }),
    [],
  );
  const geo = useMemo(
    () => ({
      floor: tiledPlane(HALF_WIDTH * 2, LENGTH, FLOOR_TILE),
      ceiling: tiledPlane(HALF_WIDTH * 2, LENGTH, CEILING_TILE),
      endWall: wallPlane(HALF_WIDTH * 2, HEIGHT),
      walls: corridorWalls(),
      roomFloor: tiledPlane(ROOM_DEPTH, ROOM_WIDTH, FLOOR_TILE),
      roomCeiling: tiledPlane(ROOM_DEPTH, ROOM_WIDTH, CEILING_TILE),
      roomBack: wallPlane(ROOM_WIDTH, HEIGHT),
      roomSide: wallPlane(ROOM_DEPTH, HEIGHT),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const t of Object.values(tex)) (Array.isArray(t) ? t : [t]).forEach((x) => x.dispose());
      for (const g of Object.values(geo)) (Array.isArray(g) ? g.map((p) => p.geo) : [g]).forEach((x) => x.dispose());
    },
    [tex, geo],
  );

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
      <mesh geometry={geo.floor} rotation-x={-Math.PI / 2} position={[0, 0, mid]}>
        <meshStandardMaterial map={tex.floor} roughness={0.7} />
      </mesh>
      <mesh geometry={geo.ceiling} rotation-x={Math.PI / 2} position={[0, HEIGHT, mid]}>
        <meshStandardMaterial map={tex.ceiling} roughness={1} />
      </mesh>
      {/* 병실 안에서도 보이게 양면 */}
      {geo.walls.map((w, i) => (
        <mesh key={i} geometry={w.geo} position={w.position} rotation-y={w.rotY}>
          <meshStandardMaterial map={tex.wall} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh geometry={geo.endWall} position={[0, HEIGHT / 2, -LENGTH]}>
        <meshStandardMaterial map={tex.wall} roughness={0.95} />
      </mesh>
      <mesh geometry={geo.endWall} rotation-y={Math.PI} position={[0, HEIGHT / 2, 0]}>
        <meshStandardMaterial map={tex.wall} roughness={0.95} />
      </mesh>

      {ROOMS.map((room) => (
        <RoomShell key={room.index} room={room} geo={geo} tex={tex} />
      ))}
      {ROOMS.map((room) => (
        <Door
          key={room.index}
          gameRef={gameRef}
          id={room.index}
          position={[room.door.side * HALF_WIDTH, 0, room.cz]}
          rotY={(-room.door.side * Math.PI) / 2}
          map={tex.door}
          plate={tex.plates[room.index]}
          sign={room.door.locked ? tex.sign : undefined}
        />
      ))}
      {/* 복도 끝, 잠긴 문 */}
      <Door gameRef={gameRef} id={END_DOOR} position={[0, 0, -LENGTH + 0.03]} rotY={0} map={tex.endDoor} />

      {/* 벽의 낙서 */}
      <mesh rotation-y={Math.PI / 2} position={[-HALF_WIDTH + 0.01, 1.6, -40]}>
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

// ---------------------------------------------------------------- 병실

function RoomShell({
  room,
  geo,
  tex,
}: {
  room: Room;
  geo: Record<"roomFloor" | "roomCeiling" | "roomBack" | "roomSide", THREE.BufferGeometry>;
  tex: Record<"wall" | "floor" | "ceiling" | "mattress", THREE.Texture>;
}) {
  const { cx, cz } = room;
  const side = room.door.side;
  const backX = side * (HALF_WIDTH + ROOM_DEPTH);
  const facingIn = (-side * Math.PI) / 2;
  return (
    <group>
      <mesh geometry={geo.roomFloor} rotation-x={-Math.PI / 2} position={[cx, 0, cz]}>
        <meshStandardMaterial map={tex.floor} roughness={0.7} />
      </mesh>
      <mesh geometry={geo.roomCeiling} rotation-x={Math.PI / 2} position={[cx, HEIGHT, cz]}>
        <meshStandardMaterial map={tex.ceiling} roughness={1} />
      </mesh>
      <mesh geometry={geo.roomBack} rotation-y={facingIn} position={[backX, HEIGHT / 2, cz]}>
        <meshStandardMaterial map={tex.wall} roughness={0.95} />
      </mesh>
      <mesh geometry={geo.roomSide} position={[cx, HEIGHT / 2, cz - ROOM_WIDTH / 2]}>
        <meshStandardMaterial map={tex.wall} roughness={0.95} />
      </mesh>
      <mesh geometry={geo.roomSide} rotation-y={Math.PI} position={[cx, HEIGHT / 2, cz + ROOM_WIDTH / 2]}>
        <meshStandardMaterial map={tex.wall} roughness={0.95} />
      </mesh>

      {/* 창살 너머로 희미한 달빛 */}
      <group position={[backX - side * 0.02, 1.7, room.windowZ]} rotation-y={facingIn}>
        <mesh>
          <boxGeometry args={[1.0, 0.8, 0.04]} />
          <meshStandardMaterial color="#2c2a26" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[0.88, 0.68]} />
          <meshStandardMaterial color="#0b1220" emissive="#22344f" emissiveIntensity={0.55} roughness={0.15} />
        </mesh>
        {[-0.3, -0.1, 0.1, 0.3].map((x) => (
          <mesh key={x} position={[x, 0, 0.04]}>
            <boxGeometry args={[0.025, 0.7, 0.025]} />
            <meshStandardMaterial color="#1c1b19" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}
      </group>

      {room.props.map((p, i) => (
        <PropModel key={i} prop={p} mattress={tex.mattress} />
      ))}
    </group>
  );
}

const METAL = { color: "#5b605d", metalness: 0.6, roughness: 0.45 } as const;

function PropModel({ prop, mattress }: { prop: Prop; mattress: THREE.Texture }) {
  if (prop.kind === "bed") {
    // 로컬 +x 쪽이 머리 (안쪽 벽)
    return (
      <group position={[prop.x, 0, prop.z]} rotation-y={prop.rotY}>
        {[-0.95, 0.95].flatMap((x) =>
          [-0.43, 0.43].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.21, z]}>
              <boxGeometry args={[0.04, 0.42, 0.04]} />
              <meshStandardMaterial {...METAL} />
            </mesh>
          )),
        )}
        <mesh position={[0, 0.43, 0]}>
          <boxGeometry args={[2.0, 0.05, 0.95]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[0.99, 0.72, 0]}>
          <boxGeometry args={[0.04, 0.58, 0.95]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[-0.99, 0.6, 0]}>
          <boxGeometry args={[0.04, 0.34, 0.95]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[0, 0.53, 0]}>
          <boxGeometry args={[1.9, 0.15, 0.9]} />
          <meshStandardMaterial map={mattress} roughness={0.95} />
        </mesh>
        <mesh position={[0.74, 0.65, 0.04]} rotation-y={0.12}>
          <boxGeometry args={[0.32, 0.09, 0.58]} />
          <meshStandardMaterial color="#8d897e" roughness={1} />
        </mesh>
      </group>
    );
  }
  if (prop.kind === "cabinet") {
    // 로컬 +x 쪽이 앞면
    return (
      <group position={[prop.x, 0, prop.z]} rotation-y={prop.rotY}>
        <mesh position={[0, 0.45, 0]}>
          <boxGeometry args={[0.45, 0.9, 0.5]} />
          <meshStandardMaterial color="#6a685d" metalness={0.3} roughness={0.7} />
        </mesh>
        {[0.62, 0.32].map((y) => (
          <group key={y}>
            <mesh position={[0.226, y, 0]}>
              <boxGeometry args={[0.005, 0.24, 0.44]} />
              <meshStandardMaterial color="#2e2d28" roughness={0.9} />
            </mesh>
            <mesh position={[0.235, y, 0]}>
              <boxGeometry args={[0.015, 0.02, 0.12]} />
              <meshStandardMaterial {...METAL} />
            </mesh>
          </group>
        ))}
      </group>
    );
  }
  // 넘어진 의자
  return (
    <group position={[prop.x, 0.21, prop.z]} rotation={[0, prop.rotY, Math.PI / 2]}>
      <mesh position={[0, 0.0, 0]}>
        <boxGeometry args={[0.42, 0.04, 0.42]} />
        <meshStandardMaterial color="#4a3a2c" roughness={0.9} />
      </mesh>
      <mesh position={[-0.19, 0.25, 0]}>
        <boxGeometry args={[0.04, 0.46, 0.42]} />
        <meshStandardMaterial color="#4a3a2c" roughness={0.9} />
      </mesh>
      {[-0.18, 0.18].flatMap((x) =>
        [-0.18, 0.18].map((z) => (
          <mesh key={`${x}${z}`} position={[x, -0.21, z]}>
            <boxGeometry args={[0.03, 0.42, 0.03]} />
            <meshStandardMaterial {...METAL} />
          </mesh>
        )),
      )}
    </group>
  );
}

// ---------------------------------------------------------------- 문

/**
 * 문틀 + 경첩에 매달린 문짝. 로컬 +z 가 복도 쪽이고 문짝은 -z(방 안)로 열린다.
 * 문짝은 gameRef.targets 에 등록돼 화면 가운데 광선으로 E 상호작용 대상이 된다.
 */
function Door({
  gameRef,
  id,
  position,
  rotY,
  map,
  plate,
  sign,
}: {
  gameRef: RefObject<HorrorState>;
  id: number;
  position: [number, number, number];
  rotY: number;
  map: THREE.Texture;
  plate?: THREE.Texture;
  sign?: THREE.Texture;
}) {
  const hinge = useRef<THREE.Group>(null);
  const leaf = useRef<THREE.Mesh>(null);
  const opening = useRef<THREE.Mesh>(null);

  // 문짝과 문틀 자리(열려 있을 때 문틀을 보고 닫을 수 있게)를 상호작용 대상으로 등록
  useEffect(() => {
    const s = gameRef.current;
    const meshes = [leaf.current, opening.current].filter((m): m is THREE.Mesh => m !== null);
    for (const m of meshes) {
      m.userData.door = id;
      s.targets.push(m);
    }
    return () => {
      for (const m of meshes) {
        const i = s.targets.indexOf(m);
        if (i >= 0) s.targets.splice(i, 1);
      }
    };
  }, [gameRef, id]);

  useFrame((_, delta) => {
    const h = hinge.current;
    if (!h || id === END_DOOR) return;
    const s = gameRef.current;
    const target = s.doorOpen[id] ? DOOR_OPEN_ANGLE : 0;
    const before = h.rotation.y;
    h.rotation.y += (target - before) * Math.min(1, delta * 4);
    if (!target && before > 0.04 && h.rotation.y <= 0.04) {
      h.rotation.y = 0;
      s.audio?.thud();
    }
  });

  const isEnd = id === END_DOOR;
  const frame = "#2a2019";
  return (
    <group position={position} rotation-y={rotY}>
      {/* 문틀 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (DOOR_WIDTH / 2 + 0.035), (DOOR_HEIGHT + 0.07) / 2, 0]}>
          <boxGeometry args={[0.07, DOOR_HEIGHT + 0.07, isEnd ? 0.06 : 0.14]} />
          <meshStandardMaterial color={frame} roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, DOOR_HEIGHT + 0.035, 0]}>
        <boxGeometry args={[DOOR_WIDTH + 0.14, 0.07, isEnd ? 0.06 : 0.14]} />
        <meshStandardMaterial color={frame} roughness={0.85} />
      </mesh>
      {!isEnd && (
        // 보이지 않는 문틀 판: 광선 검사에만 쓴다 (Raycaster 는 visible 과 상관없이 맞힌다)
        <mesh ref={opening} position={[0, DOOR_HEIGHT / 2, 0]} visible={false}>
          <planeGeometry args={[DOOR_WIDTH, DOOR_HEIGHT]} />
          <meshBasicMaterial side={THREE.DoubleSide} />
        </mesh>
      )}
      {plate && (
        <mesh position={[0, DOOR_HEIGHT + 0.22, 0.012]}>
          <planeGeometry args={[0.26, 0.11]} />
          <meshStandardMaterial map={plate} roughness={0.6} />
        </mesh>
      )}

      <group ref={hinge} position={[-DOOR_WIDTH / 2, 0, isEnd ? 0.03 : 0]}>
        <mesh ref={leaf} position={[DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0]}>
          <boxGeometry args={[DOOR_WIDTH - 0.02, DOOR_HEIGHT - 0.01, 0.05]} />
          <meshStandardMaterial map={map} roughness={0.85} />
          {[-1, 1].map((s) => (
            <mesh key={s} position={[DOOR_WIDTH / 2 - 0.13, 1.0 - DOOR_HEIGHT / 2, s * 0.045]}>
              <sphereGeometry args={[0.032, 12, 8]} />
              <meshStandardMaterial color="#8a7f6a" metalness={0.8} roughness={0.35} />
            </mesh>
          ))}
          {/* 문 위쪽 작은 유리창 */}
          <mesh position={[0, 1.72 - DOOR_HEIGHT / 2, 0]}>
            <boxGeometry args={[0.34, 0.22, 0.056]} />
            <meshStandardMaterial color="#050607" roughness={0.15} metalness={0.5} />
          </mesh>
          {sign && (
            <mesh position={[0, 1.3 - DOOR_HEIGHT / 2, 0.027]} rotation-z={0.04}>
              <planeGeometry args={[0.3, 0.22]} />
              <meshStandardMaterial map={sign} roughness={1} />
            </mesh>
          )}
        </mesh>
      </group>
    </group>
  );
}
