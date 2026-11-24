import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { AirHockeyState } from "../protocol.js";

export const iceColors = { left: "#44dcff", right: "#ff983e" } as const;
type Side = keyof typeof iceColors;
type RinkSize = Pick<AirHockeyState, "arenaWidth" | "arenaHeight" | "paddleRadius" | "puckRadius" | "goalSize">;
export type RinkPose = { puckX: number; puckY: number; leftX: number; leftY: number; rightX: number; rightY: number };
const units = 0.01;
const metal = (color: string, roughness = 0.42, metalness = 0.16) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function box(root: THREE.Group, material: THREE.Material, x: number, y: number, z: number,
  width: number, height: number, depth: number, bevel = 0.02): void {
  const shape = bevel ? new RoundedBoxGeometry(width, height, depth, 2, bevel) : new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(shape, material);
  mesh.position.set(x, y, z);
  root.add(mesh);
}

function disc(root: THREE.Group, material: THREE.Material, top: number, bottom: number, height: number, y: number): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 48), material);
  mesh.position.y = y;
  root.add(mesh);
}

function iceTexture(width: number, depth: number, mouth: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = Math.round(canvas.width * depth / width);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(canvas.width / width, canvas.height / depth);

  const tint = ctx.createLinearGradient(0, 0, width, 0);
  tint.addColorStop(0, "#3997b2");
  tint.addColorStop(0.28, "#91bbc9");
  tint.addColorStop(0.50, "#b2c2ce");
  tint.addColorStop(0.72, "#c7b7b2");
  tint.addColorStop(1, "#c88763");
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, width, depth);
  const rim = ctx.createLinearGradient(0, 0, 0, depth);
  rim.addColorStop(0, "#1d2c4560");
  rim.addColorStop(0.13, "#ffffff00");
  rim.addColorStop(0.83, "#ffffff16");
  rim.addColorStop(1, "#1d2c454d");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, width, depth);

  ctx.strokeStyle = "#f0faffc0";
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, depth);
  ctx.stroke();
  const arc = (x: number, radius: number, start: number, end: number) => {
    ctx.beginPath();
    ctx.arc(x, depth / 2, radius, start, end);
    ctx.stroke();
  };
  arc(width / 2, 1.11, 0, 2 * Math.PI);
  arc(0, mouth / 2 + 0.26, -Math.PI / 2, Math.PI / 2);
  arc(width, mouth / 2 + 0.26, Math.PI / 2, 3 * Math.PI / 2);
  ctx.fillStyle = "#f0faffc0";
  ctx.fillRect(width * 0.31, depth / 2 - 0.16, 0.035, 0.32);
  ctx.fillRect(width * 0.69, depth / 2 - 0.16, 0.035, 0.32);

  for (let z = 0.19; z < depth - 0.10; z += 0.16) {
    for (let x = 0.18; x < width - 0.10; x += 0.16) {
      ctx.fillStyle = "#e8faff75";
      ctx.fillRect(x, z + 0.012, 0.015, 0.011);
      ctx.fillStyle = "#263a556c";
      ctx.fillRect(x, z, 0.015, 0.013);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function contactTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 8, 32, 32, 32);
  gradient.addColorStop(0, "#000c15c9");
  gradient.addColorStop(0.58, "#000c157d");
  gradient.addColorStop(1, "#000c1500");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function shadow(root: THREE.Group, texture: THREE.Texture, width: number, depth: number, y: number): void {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0.06, y, 0.08);
  root.add(mesh);
}

/** The scene uses rink coordinates. It renders server snapshots and has no game rules. */
export class Rink3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  private readonly table = new THREE.Group();
  private readonly left = new THREE.Group();
  private readonly right = new THREE.Group();
  private readonly puck = new THREE.Group();
  private readonly textures: THREE.Texture[] = [];
  private readonly lamps: Record<Side, THREE.MeshStandardMaterial | null> = { left: null, right: null };
  private width = 0;
  private depth = 0;
  private viewWidth = 0;
  private viewHeight = 0;
  private lost = false;
  private sizeKey = "";

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onRestored);
    Object.assign(this.renderer.domElement.style, { position: "fixed", zIndex: "1", pointerEvents: "none", display: "none" });
    parent.append(this.renderer.domElement);

    this.scene.add(this.table, this.left, this.right, this.puck);
    this.scene.add(new THREE.HemisphereLight("#e6f4ff", "#647590", 2.15));
    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    key.position.set(-3, 9, -4);
    const fill = new THREE.DirectionalLight("#b6d3ff", 0.9);
    fill.position.set(3, 2, 7);
    this.scene.add(key, fill);
  }

  private onLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.hide();
  };

  private onRestored = (): void => {
    this.lost = false;
  };

  hide(): void {
    this.renderer.domElement.style.display = "none";
  }

  configure(size: RinkSize): void {
    const key = [size.arenaWidth, size.arenaHeight, size.goalSize, size.paddleRadius, size.puckRadius].join(":");
    if (key === this.sizeKey) return;
    this.sizeKey = key;
    this.releaseModels();
    this.width = size.arenaWidth * units;
    this.depth = size.arenaHeight * units;
    this.viewWidth = 0;
    const width = this.width;
    const depth = this.depth;
    const mouth = size.goalSize * units;
    const rail = 0.22;
    const slot = 0.39;
    const cabinet = metal("#101925");
    const railTop = metal("#3d4c5b", 0.36, 0.28);
    const rubber = metal("#182532");
    const hardware = metal("#8a9eaf", 0.26, 0.5);
    const socket = new THREE.MeshBasicMaterial({ color: "#090e14" });
    const ice = iceTexture(width, depth, mouth);
    const contact = contactTexture();
    this.textures.push(ice, contact);

    shadow(this.table, contact, width * 1.36, depth * 1.50, -0.74);
    box(this.table, new THREE.MeshStandardMaterial({ map: ice, roughness: 0.83 }),
      0, -0.055, 0, width, 0.11, depth, 0);
    box(this.table, cabinet, 0, -0.30, 0, width + 2 * (rail + slot), 0.38, depth + 2 * rail, 0.075);
    for (const z of [-depth / 2 - rail / 2, depth / 2 + rail / 2]) {
      box(this.table, rubber, 0, 0.055, z, width + 2 * (rail + slot), 0.15, rail);
      box(this.table, railTop, 0, 0.15, z, width + 2 * (rail + slot), 0.07, rail);
      for (const x of [-0.46, -0.23, 0, 0.23, 0.46]) {
        const screw = new THREE.Group();
        screw.position.set(x * width, 0, z);
        disc(screw, hardware, 0.032, 0.032, 0.008, 0.19);
        box(screw, rubber, 0, 0.195, 0, 0.037, 0.004, 0.009, 0);
        this.table.add(screw);
      }
    }

    for (const side of ["left", "right"] as const) {
      const sign = side === "left" ? -1 : 1;
      const color = iceColors[side];
      const end = sign * width / 2;
      const lamp = new THREE.MeshStandardMaterial({ color: "#101925", emissive: color, emissiveIntensity: 1.22 });
      this.lamps[side] = lamp;
      const cornerLength = (depth - mouth) / 2;
      for (const z of [-1, 1]) {
        const corner = z * (mouth / 2 + cornerLength / 2);
        box(this.table, rubber, end + sign * (slot + rail) / 2, 0.048, corner, slot + rail, 0.16, cornerLength);
        box(this.table, railTop, end + sign * (slot + rail) / 2, 0.14, corner, slot + rail, 0.07, cornerLength, 0.025);
        box(this.table, hardware, end + sign * 0.10, 0.06, z * (mouth / 2 + 0.025), 0.20, 0.13, 0.05);
        box(this.table, cabinet, sign * (width / 2 - 0.5), -0.55, z * (depth / 2 - 0.42), 0.58, 0.36, 0.56, 0.07);
      }
      // A recessed net with its own floor, back wall and illuminated frame.
      box(this.table, socket, end + sign * slot / 2, -0.105, 0, slot + 0.004, 0.025, mouth, 0);
      box(this.table, rubber, end + sign * (slot + rail / 2), 0.048, 0, rail, 0.16, mouth);
      box(this.table, railTop, end + sign * (slot + rail / 2), 0.14, 0, rail, 0.07, mouth);
      box(this.table, lamp, end + sign * (slot - 0.015), 0.123, 0, 0.026, 0.017, mouth - 0.12);
      box(this.table, lamp, end - sign * 0.69, -0.18, depth / 2 + rail + 0.004, 1.55, 0.035, 0.016);
      box(this.table, lamp, end + sign * (rail + slot + 0.004), -0.13, 0, 0.016, 0.035, depth * 0.86);

      const paddle = this[side];
      const radius = size.paddleRadius * units;
      shadow(paddle, contact, radius * 3.1, radius * 2.95, 0.004);
      const body = metal(side === "left" ? "#0089bc" : "#d95809", 0.38, 0.10);
      disc(paddle, rubber, radius, radius * 0.96, 0.045, 0.037);
      disc(paddle, body, radius, radius, 0.15, 0.119);
      disc(paddle, body, radius * 0.91, radius, 0.046, 0.215);
      disc(paddle, metal("#213041", 0.65), radius * 0.52, radius * 0.43, 0.23, 0.33);
      disc(paddle, metal("#33485d", 0.6), radius * 0.47, radius * 0.52, 0.056, 0.47);
      disc(paddle, lamp.clone(), radius * 0.27, radius * 0.30, 0.012, 0.50);
    }

    const radius = size.puckRadius * units;
    shadow(this.puck, contact, radius * 3.35, radius * 3.1, 0.006);
    disc(this.puck, socket, radius, radius * 0.96, 0.073, 0.053);
    disc(this.puck, new THREE.MeshBasicMaterial({ color: "#ffe8b4" }), radius, radius, 0.018, 0.091);
    disc(this.puck, metal("#142435", 0.63), radius * 0.87, radius * 0.92, 0.015, 0.104);
    disc(this.puck, metal("#65869d"), radius * 0.22, radius * 0.22, 0.004, 0.113);
  }

  render(pose: RinkPose, canvas: HTMLCanvasElement, viewport: { top: number; bottom: number },
    flash: { side: Side; strength: number } | null): boolean {
    if (this.lost) return false;
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height * (viewport.bottom - viewport.top));
    if (width < 1 || height < 1) return false;

    const element = this.renderer.domElement;
    element.style.display = "block";
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top + rect.height * viewport.top}px`;
    if (width !== this.viewWidth || height !== this.viewHeight) {
      this.viewWidth = width;
      this.viewHeight = height;
      this.renderer.setSize(width, height);
      const aspect = width / height;
      const span = this.width + 1.28;
      const angle = THREE.MathUtils.clamp(Math.asin(Math.min(1, (span / aspect - 0.58) / (this.depth + 0.44))), 0.52, 1.30);
      const halfHeight = Math.max(span / aspect, (this.depth + 0.50) * Math.sin(angle) + 0.92 * Math.cos(angle)) / 2;
      this.camera.position.set(0, 17 * Math.sin(angle) - 0.24, 17 * Math.cos(angle));
      this.camera.lookAt(0, -0.24, 0);
      Object.assign(this.camera, { left: -halfHeight * aspect, right: halfHeight * aspect, top: halfHeight, bottom: -halfHeight });
      this.camera.updateProjectionMatrix();
    }

    this.left.position.set(pose.leftX * units - this.width / 2, 0, pose.leftY * units - this.depth / 2);
    this.right.position.set(pose.rightX * units - this.width / 2, 0, pose.rightY * units - this.depth / 2);
    this.puck.position.set(pose.puckX * units - this.width / 2, 0, pose.puckY * units - this.depth / 2);
    for (const side of ["left", "right"] as const) {
      const lamp = this.lamps[side];
      if (lamp) lamp.emissiveIntensity = 1.22 + (flash?.side === side ? flash.strength * 3 : 0);
    }
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  private releaseModels(): void {
    const materials = new Set<THREE.Material>();
    for (const group of [this.table, this.left, this.right, this.puck]) {
      group.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        materials.add(node.material as THREE.Material);
      });
      group.clear();
    }
    materials.forEach(material => material.dispose());
    this.textures.splice(0).forEach(texture => texture.dispose());
  }

  dispose(): void {
    const element = this.renderer.domElement;
    element.removeEventListener("webglcontextlost", this.onLost);
    element.removeEventListener("webglcontextrestored", this.onRestored);
    this.releaseModels();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    element.remove();
  }
}
