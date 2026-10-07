import * as THREE from "three";

/** 그림 파일 없이 캔버스에 그려서 만드는 텍스처들. 만들 때마다 얼룩 위치가 조금씩 달라진다 */

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
export const wallTexture = () =>
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

export const floorTexture = () =>
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

export const ceilingTexture = () =>
  canvasTexture(128, 128, (g) => {
    g.fillStyle = "#4a4a46";
    g.fillRect(0, 0, 128, 128);
    stains(g, 8, "rgba(35,28,18,0.5)");
    grain(g, 20);
  });

/** 패널 두 칸짜리 낡은 나무 문. scratches: 손톱 자국 */
export const doorTexture = (base: string, scratches = false) =>
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

export const writingTexture = () =>
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

/** 문 위 호실 번호판 */
export const plateTexture = (text: string) =>
  canvasTexture(128, 56, (g) => {
    g.fillStyle = "#b9b4a4";
    g.fillRect(0, 0, 128, 56);
    g.strokeStyle = "#3a352c";
    g.lineWidth = 4;
    g.strokeRect(2, 2, 124, 52);
    g.fillStyle = "#1d1b17";
    g.font = "bold 30px 'Helvetica Neue', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 64, 30);
    stains(g, 3, "rgba(60,40,20,0.35)");
    grain(g, 14);
  });

/** 잠긴 문에 붙은 종이 */
export const signTexture = () =>
  canvasTexture(128, 96, (g) => {
    g.fillStyle = "#cfc8b4";
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = "rgba(160,150,120,0.6)";
    g.fillRect(-6, 4, 40, 12);
    g.fillRect(96, 2, 40, 12);
    g.fillStyle = "#8a0d12";
    g.font = "bold 26px 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("출입금지", 64, 52);
    stains(g, 4, "rgba(90,70,30,0.35)");
    grain(g, 16);
  });

/** 누렇게 얼룩진 매트리스 (가운데 핏자국) */
export const mattressTexture = () =>
  canvasTexture(128, 128, (g) => {
    g.fillStyle = "#8c877b";
    g.fillRect(0, 0, 128, 128);
    stains(g, 10, "rgba(110,90,40,0.35)");
    stains(g, 2, "rgba(80,8,8,0.7)");
    grain(g, 18);
  });

/** 핏기 없는 피부와 비치는 핏줄 */
export const skinTexture = () =>
  canvasTexture(128, 128, (g) => {
    g.fillStyle = "#aaa59b";
    g.fillRect(0, 0, 128, 128);
    stains(g, 10, "rgba(70,60,75,0.22)");
    g.strokeStyle = "rgba(55,65,95,0.32)";
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      let x = Math.random() * 128;
      let y = Math.random() * 128;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (Math.random() - 0.5) * 22;
        y += 6 + Math.random() * 12;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    grain(g, 12);
  });

/** 무늬가 바랜 환자복. 아래로 갈수록 피와 때가 묻어 있다 */
export const gownTexture = () =>
  canvasTexture(256, 256, (g) => {
    g.fillStyle = "#8f8c81";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "rgba(70,90,120,0.3)";
    for (let y = 8; y < 256; y += 16) {
      for (let x = (y / 16) % 2 ? 8 : 0; x < 256; x += 16) {
        g.fillRect(x, y, 3, 3);
      }
    }
    // 세로 주름 그림자
    for (let x = 0; x < 256; x += 18 + Math.random() * 20) {
      const grad = g.createLinearGradient(x, 0, x + 10, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, "rgba(0,0,0,0.22)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x, 0, 10, 256);
    }
    stains(g, 12, "rgba(60,50,30,0.35)");
    // 밑단 쪽 핏자국과 흘러내린 자국
    for (let i = 0; i < 7; i++) {
      const x = Math.random() * 256;
      const y = 170 + Math.random() * 80;
      const r = 10 + Math.random() * 26;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(85,8,8,0.75)");
      grad.addColorStop(1, "rgba(85,8,8,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = "rgba(85,8,8,0.55)";
    for (let i = 0; i < 6; i++) g.fillRect(Math.random() * 256, 120 + Math.random() * 60, 2, 30 + Math.random() * 60);
    grain(g, 16);
  });

/** 얼굴 앞으로 늘어진 머리카락 (투명 배경). 오른쪽 눈 자리는 가르마처럼 듬성듬성하다 */
export const hairCurtainTexture = () =>
  canvasTexture(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = "#060606";
    for (let i = 0; i < 150; i++) {
      let x = Math.random() * 256;
      if (Math.abs(x - 156) < 16 && Math.random() < 0.9) continue;
      const len = 110 + Math.random() * 146;
      g.lineWidth = 1 + Math.random() * 2.5;
      g.globalAlpha = 0.6 + Math.random() * 0.4;
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 16; y < len; y += 16) {
        x += (Math.random() - 0.5) * 3;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  });
