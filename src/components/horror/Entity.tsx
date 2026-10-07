"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { HorrorState } from "./state";
import { gownTexture, hairCurtainTexture, skinTexture } from "./textures";

/** 엔티티 눈높이 (m). 점프스케어 때 얼굴을 카메라 높이에 맞추는 데 쓴다 */
export const ENTITY_EYE_HEIGHT = 1.69;

const NECK_Y = 1.57;
const SHOULDER_Y = 1.42;
const SHOULDER_X = 0.2;

/**
 * 환자복을 입은 마른 사람. 긴 검은 머리가 얼굴을 덮고, 팔이 무릎까지 내려올 만큼 길다.
 * 얼굴(+z)이 lookAt 대상 쪽을 본다. 자세는 gameRef.entityPose 를 따른다
 */
export function Entity({ ref, gameRef }: { ref: RefObject<THREE.Group | null>; gameRef: RefObject<HorrorState> }) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const shoulders = useRef<(THREE.Group | null)[]>([]);
  const elbows = useRef<(THREE.Group | null)[]>([]);
  const fingers = useRef<(THREE.Group | null)[]>([]);
  const twitch = useRef({ next: 0, tilt: 0.38, turn: 0 });

  const assets = useMemo(() => {
    // 밑단이 뜯기고 주름진 환자복 (정수배 주파수라 이음매가 벌어지지 않는다)
    const gown = new THREE.CylinderGeometry(0.16, 0.28, 0.98, 32, 6, true);
    const pos = gown.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(x, z);
      const low = (0.49 - y) / 0.98;
      const fold = 1 + Math.sin(a * 7) * 0.04 * low + Math.sin(a * 3 + 1) * 0.02;
      const tear = y < -0.48 ? (Math.sin(a * 23) * 0.5 + 0.5) * 0.07 + (Math.sin(a * 9 + 2) * 0.5 + 0.5) * 0.06 : 0;
      pos.setXYZ(i, x * fold, y - tear, z * fold);
    }
    gown.computeVertexNormals();

    return { gown, skin: skinTexture(), cloth: gownTexture(), curtain: hairCurtainTexture() };
  }, []);
  useEffect(
    () => () => {
      assets.gown.dispose();
      assets.skin.dispose();
      assets.cloth.dispose();
      assets.curtain.dispose();
    },
    [assets],
  );

  useFrame(({ clock }, delta) => {
    const root = ref.current;
    if (!root?.visible) return;
    const s = gameRef.current;
    const t = clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const reach = s.entityPose === "reach";
    const ease = (from: number, to: number, speed: number) => from + (to - from) * Math.min(1, dt * speed);

    // 숨 쉬듯 미세하게 흔들린다
    const b = body.current;
    if (b) {
      b.rotation.z = Math.sin(t * 0.9) * 0.015;
      b.scale.y = 1 + Math.sin(t * 1.7) * 0.006;
    }

    // 고개를 갸웃한 채로 있다가 가끔 뚝 꺾는다
    const tw = twitch.current;
    if (t > tw.next) {
      tw.next = t + 0.5 + Math.random() * 2.2;
      tw.tilt = (Math.random() < 0.75 ? 1 : -1) * (0.2 + Math.random() * 0.3);
      tw.turn = (Math.random() - 0.5) * 0.3;
    }
    const h = head.current;
    if (h) {
      h.rotation.z = ease(h.rotation.z, reach ? 0.08 : tw.tilt, reach ? 10 : 22);
      h.rotation.y = ease(h.rotation.y, reach ? 0 : tw.turn, 22);
      h.rotation.x = ease(h.rotation.x, reach ? -0.1 : 0.18, 8);
    }

    // 평소엔 팔이 축 늘어져 있고, 덮칠 때는 앞으로 뻗는다
    shoulders.current.forEach((sh, i) => {
      if (!sh) return;
      const side = i ? 1 : -1;
      sh.rotation.x = ease(sh.rotation.x, reach ? -1.35 + side * 0.08 : 0.05 + Math.sin(t * 1.3 + i) * 0.02, reach ? 14 : 4);
      sh.rotation.z = ease(sh.rotation.z, side * (reach ? 0.14 : 0.05), 6);
    });
    elbows.current.forEach((el) => {
      if (el) el.rotation.x = ease(el.rotation.x, reach ? -0.12 : -0.28, reach ? 14 : 4);
    });
    fingers.current.forEach((f, i) => {
      if (f) f.rotation.x = ease(f.rotation.x, reach ? -0.25 : 0.2 + Math.sin(t * 9 + i) * 0.05, 10);
    });
  });

  const skin = <meshStandardMaterial map={assets.skin} roughness={0.8} />;
  const cloth = <meshStandardMaterial map={assets.cloth} roughness={0.95} side={THREE.DoubleSide} />;
  // 머리카락은 손전등을 반사하지 않게 정반사 없는 재질
  const hair = <meshLambertMaterial color="#070707" side={THREE.DoubleSide} />;

  return (
    <group ref={ref} visible={false}>
      <group ref={body}>
        {/* 다리: 환자복 아래로 앙상한 정강이와 맨발 */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.09, 0, 0]}>
            <mesh position={[0, 0.03, 0.05]}>
              <boxGeometry args={[0.075, 0.05, 0.22]} />
              {skin}
            </mesh>
            <mesh position={[0, 0.27, 0]}>
              <capsuleGeometry args={[0.036, 0.36, 4, 10]} />
              {skin}
            </mesh>
            <mesh position={[0, 0.47, 0.01]}>
              <sphereGeometry args={[0.043, 12, 8]} />
              {skin}
            </mesh>
            <mesh position={[0, 0.72, 0]}>
              <capsuleGeometry args={[0.058, 0.3, 4, 10]} />
              {skin}
            </mesh>
          </group>
        ))}

        {/* 환자복과 어깨 */}
        <mesh geometry={assets.gown} position={[0, 0.96, 0]}>
          {cloth}
        </mesh>
        <mesh position={[0, SHOULDER_Y + 0.02, 0]} scale={[1.55, 0.55, 0.9]}>
          <sphereGeometry args={[0.13, 20, 12]} />
          {cloth}
        </mesh>

        {/* 팔: 어깨 → 팔꿈치 → 손목 마디마다 돌릴 수 있게 */}
        {[-1, 1].map((side, i) => (
          <group
            key={side}
            ref={(g) => {
              shoulders.current[i] = g;
            }}
            position={[side * SHOULDER_X, SHOULDER_Y, 0]}
          >
            <mesh position={[0, -0.06, 0]}>
              <capsuleGeometry args={[0.05, 0.1, 4, 10]} />
              {cloth}
            </mesh>
            <mesh position={[0, -0.18, 0]}>
              <capsuleGeometry args={[0.031, 0.27, 4, 8]} />
              {skin}
            </mesh>
            <group
              ref={(g) => {
                elbows.current[i] = g;
              }}
              position={[0, -0.34, 0]}
            >
              <mesh>
                <sphereGeometry args={[0.032, 10, 8]} />
                {skin}
              </mesh>
              <mesh position={[0, -0.16, 0]}>
                <capsuleGeometry args={[0.026, 0.28, 4, 8]} />
                {skin}
              </mesh>
              <group position={[0, -0.33, 0]}>
                <mesh position={[0, -0.045, 0]}>
                  <boxGeometry args={[0.055, 0.085, 0.022]} />
                  {skin}
                </mesh>
                <mesh position={[-side * 0.032, -0.05, 0.012]} rotation-z={-side * 0.45}>
                  <capsuleGeometry args={[0.007, 0.06, 4, 6]} />
                  {skin}
                </mesh>
                <group
                  ref={(g) => {
                    fingers.current[i] = g;
                  }}
                  position={[0, -0.09, 0]}
                >
                  {[-0.021, -0.007, 0.007, 0.021].map((x, j) => (
                    <mesh key={x} position={[x, -0.055 + Math.abs(j - 1.5) * 0.008, 0]}>
                      <capsuleGeometry args={[0.0065, 0.1 - Math.abs(j - 1.5) * 0.012, 4, 6]} />
                      {skin}
                    </mesh>
                  ))}
                </group>
              </group>
            </group>
          </group>
        ))}

        {/* 목 */}
        <mesh position={[0, NECK_Y - 0.05, 0]}>
          <cylinderGeometry args={[0.032, 0.038, 0.14, 12]} />
          {skin}
        </mesh>

        {/* 머리: 목을 축으로 꺾인다 */}
        <group ref={head} position={[0, NECK_Y, 0]}>
          <mesh position={[0, 0.11, 0]} scale={[0.86, 1.12, 0.95]}>
            <sphereGeometry args={[0.1, 24, 16]} />
            {skin}
          </mesh>
          {/* 길쭉한 턱 */}
          <mesh position={[0, 0.04, 0.03]} scale={[0.95, 0.9, 1]}>
            <sphereGeometry args={[0.058, 16, 12]} />
            {skin}
          </mesh>
          {/* 움푹 꺼진 눈두덩과 빛나는 눈동자 */}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.034, 0.12, 0]}>
              <mesh position={[0, 0, 0.077]}>
                <sphereGeometry args={[0.022, 12, 8]} />
                <meshBasicMaterial color="#0b0808" />
              </mesh>
              <mesh position={[0, 0, 0.094]}>
                <sphereGeometry args={[0.0075, 8, 6]} />
                <meshBasicMaterial color="#ff2b2b" />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0.09, 0.094]} rotation-x={Math.PI / 2}>
            <coneGeometry args={[0.011, 0.032, 8]} />
            {skin}
          </mesh>
          {/* 세로로 벌어진 입 */}
          <mesh position={[0, 0.045, 0.083]} scale={[1, 1.8, 0.5]}>
            <sphereGeometry args={[0.02, 12, 8]} />
            <meshBasicMaterial color="#0e0404" />
          </mesh>

          {/* 머리카락: 정수리, 등까지 내려오는 뒷머리, 얼굴 앞으로 늘어진 가닥 */}
          <mesh position={[0, 0.115, -0.004]} scale={[0.9, 1.12, 0.98]}>
            <sphereGeometry args={[0.108, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            {hair}
          </mesh>
          <mesh position={[0, -0.19, -0.005]}>
            <cylinderGeometry args={[0.096, 0.16, 0.64, 24, 1, true, Math.PI * 0.28, Math.PI * 1.44]} />
            {hair}
          </mesh>
          {/* 얼굴 앞을 덮은 앞머리 커튼 */}
          <mesh position={[0, -0.05, -0.004]}>
            <cylinderGeometry args={[0.12, 0.13, 0.5, 20, 1, true, -Math.PI * 0.45, Math.PI * 0.9]} />
            <meshLambertMaterial map={assets.curtain} alphaTest={0.3} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
