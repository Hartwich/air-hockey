import Phaser from "phaser";
import type { SupportedLanguage } from "@open-party-lab/game-core";
import { airHockeyManifest } from "../manifest.js";
import { clamp, type AirHockeyState } from "../protocol.js";
import { renderRoundScreens } from "./roundScreens.js";
import { iceColors, Rink3D, type RinkPose } from "./rink3d.js";

interface HostClientLike {
  subscribe(callback: (state: HostAppStateLike) => void): () => void;
}

interface HostAppStateLike {
  game?: { state?: unknown; roundNumber?: number } | null;
  room?: { language?: SupportedLanguage } | null;
}

const viewport = { top: 0.125, bottom: 0.987 };
const sides = {
  de: ["Links", "Rechts"], en: ["Left", "Right"], es: ["Izquierda", "Derecha"],
  fr: ["Gauche", "Droite"], "pt-BR": ["Esquerda", "Direita"]
};
const night = "#0c131d";

function readPose(state: AirHockeyState): RinkPose {
  const left = state.paddles[state.leftPlayerId];
  const right = state.paddles[state.rightPlayerId];
  return {
    puckX: state.puckX, puckY: state.puckY,
    leftX: left.x, leftY: left.y, rightX: right.x, rightY: right.y
  };
}

function blend(from: RinkPose, to: RinkPose, t: number): RinkPose {
  return {
    puckX: Phaser.Math.Linear(from.puckX, to.puckX, t),
    puckY: Phaser.Math.Linear(from.puckY, to.puckY, t),
    leftX: Phaser.Math.Linear(from.leftX, to.leftX, t),
    leftY: Phaser.Math.Linear(from.leftY, to.leftY, t),
    rightX: Phaser.Math.Linear(from.rightX, to.rightX, t),
    rightY: Phaser.Math.Linear(from.rightY, to.rightY, t)
  };
}

export class AirHockeyHostScene extends Phaser.Scene {
  private rink: Rink3D | null = null;
  private state: AirHockeyState | null = null;
  private previousPose?: RinkPose;
  private nextPose?: RinkPose;
  private snapshotAt = 0;
  private blendMs = 16;
  private flash?: { side: keyof typeof iceColors; at: number };
  private roundNumber?: number;
  private language: SupportedLanguage = "de";
  private covered = false;
  private hudDirty = true;
  private hud?: Phaser.GameObjects.Graphics;
  private fallback?: Phaser.GameObjects.Graphics;
  private leftName?: Phaser.GameObjects.Text;
  private rightName?: Phaser.GameObjects.Text;
  private score?: Phaser.GameObjects.Text;
  private message?: Phaser.GameObjects.Text;

  constructor() {
    super(airHockeyManifest.hostView);
  }

  create(): void {
    const client = this.registry.get("hostClient") as HostClientLike;
    this.cameras.main.setBackgroundColor(night);
    this.fallback = this.add.graphics();
    this.hud = this.add.graphics();

    const text = {
      fontFamily: '"Space Grotesk", system-ui, sans-serif',
      color: "#ebf4fb",
      fontStyle: "bold",
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    };
    this.leftName = this.add.text(0, 0, "", text).setOrigin(0, 0.5);
    this.rightName = this.add.text(0, 0, "", text).setOrigin(1, 0.5);
    this.score = this.add.text(0, 0, "", text).setOrigin(0.5);
    this.message = this.add.text(0, 0, "", { ...text, color: "#b4c8d9", fontStyle: "normal" }).setOrigin(0.5);

    const parent = this.game.canvas.parentElement;
    if (parent && "WebGL2RenderingContext" in window) {
      try {
        this.rink = new Rink3D(parent);
      } catch {
        // The Phaser rink is available if the graphics driver cannot provide WebGL.
      }
    }

    const resize = () => { this.hudDirty = true; };
    this.scale.on(Phaser.Scale.Events.RESIZE, resize);
    const unsubscribe = client.subscribe((app) => this.receive(app));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      this.scale.off(Phaser.Scale.Events.RESIZE, resize);
      this.rink?.dispose();
      this.rink = null;
      this.state = null;
      this.previousPose = this.nextPose = undefined;
      this.flash = undefined;
      this.roundNumber = undefined;
      this.hudDirty = true;
    });
  }

  private receive(app: HostAppStateLike): void {
    const covered = renderRoundScreens(this, app);
    if (covered || !app.game?.state) {
      this.covered = true;
      this.rink?.hide();
      this.fallback?.clear();
      this.state = null;
      return;
    }

    const next = app.game.state as AirHockeyState;
    const old = this.state;
    const now = performance.now();
    const roundChanged = this.roundNumber !== app.game.roundNumber || (old && next.tick < old.tick);
    const leftScore = next.scoresByPlayer[next.leftPlayerId] ?? 0;
    const rightScore = next.scoresByPlayer[next.rightPlayerId] ?? 0;
    const leftGoal = !roundChanged && old && rightScore > (old.scoresByPlayer[old.rightPlayerId] ?? 0);
    const rightGoal = !roundChanged && old && leftScore > (old.scoresByPlayer[old.leftPlayerId] ?? 0);
    const language = app.room?.language ?? "de";

    this.hudDirty ||= !old || Boolean(leftGoal || rightGoal || roundChanged) || this.language !== language ||
      next.message !== old.message || next.serveCountdownEndsAt !== old.serveCountdownEndsAt ||
      next.paddles[next.leftPlayerId]?.name !== old.paddles[old.leftPlayerId]?.name ||
      next.paddles[next.rightPlayerId]?.name !== old.paddles[old.rightPlayerId]?.name;
    this.language = language;
    this.covered = false;
    this.roundNumber = app.game.roundNumber;
    this.state = next;
    if (roundChanged) this.flash = undefined;
    if ((leftGoal || rightGoal) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.flash = { side: leftGoal ? "left" : "right", at: now };
    }

    if (!old || roundChanged || leftGoal || rightGoal || next.tick !== old.tick) {
      const pose = readPose(next);
      const snap = !old || roundChanged || leftGoal || rightGoal || next.serveCountdownEndsAt !== null;
      this.previousPose = snap ? pose : this.poseAt(now) ?? pose;
      this.nextPose = pose;
      this.blendMs = clamp(now - this.snapshotAt, 12, 55);
      this.snapshotAt = now;
      this.rink?.configure(next);
    }
  }

  private poseAt(now: number): RinkPose | undefined {
    if (!this.previousPose || !this.nextPose) return this.nextPose;
    return blend(this.previousPose, this.nextPose, clamp((now - this.snapshotAt) / this.blendMs, 0, 1));
  }

  update(): void {
    if (this.covered || !this.state) return;
    if (this.hudDirty) {
      this.drawScore(this.state);
      this.hudDirty = false;
    }
    const now = performance.now();
    const pose = this.poseAt(now);
    if (!pose) return;
    const strength = this.flash ? Math.max(0, 1 - (now - this.flash.at) / 625) : 0;
    const flash = this.flash && strength > 0 ? { side: this.flash.side, strength } : null;
    if (this.rink?.render(pose, this.game.canvas, viewport, flash)) {
      this.fallback?.setVisible(false);
    } else {
      this.fallback?.setVisible(true);
      this.drawFallback(this.state, pose);
    }
  }

  private drawScore(state: AirHockeyState): void {
    const { width, height } = this.scale;
    const topHeight = height * viewport.top;
    const fontSize = clamp(topHeight * 0.38, 18, 42);
    const pad = width * 0.035;
    const leftColor = Phaser.Display.Color.HexStringToColor(iceColors.left).color;
    const rightColor = Phaser.Display.Color.HexStringToColor(iceColors.right).color;
    const marker = Math.max(4, fontSize * 0.14);
    const nameY = topHeight * 0.40;
    this.hud?.clear().fillStyle(leftColor).fillCircle(pad + marker, nameY, marker)
      .fillStyle(rightColor).fillCircle(width - pad - marker, nameY, marker);
    const [left, right] = sides[this.language];
    this.leftName?.setPosition(pad + marker * 3.3, nameY).setFontSize(fontSize)
      .setText(state.paddles[state.leftPlayerId]?.name ?? left).setScale(1);
    this.rightName?.setPosition(width - pad - marker * 3.3, nameY).setFontSize(fontSize)
      .setText(state.paddles[state.rightPlayerId]?.name ?? right).setScale(1);
    for (const name of [this.leftName, this.rightName]) {
      if (name) name.setScale(Math.min(1, width * 0.26 / Math.max(1, name.width)));
    }
    const leftScore = state.scoresByPlayer[state.leftPlayerId] ?? 0;
    const rightScore = state.scoresByPlayer[state.rightPlayerId] ?? 0;
    this.score?.setPosition(width / 2, nameY).setFontSize(Math.round(fontSize * 1.34))
      .setText(`${leftScore} : ${rightScore}`);
    this.message?.setPosition(width / 2, topHeight * 0.82).setFontSize(clamp(topHeight * 0.20, 11, 23))
      .setText(state.serveCountdownEndsAt !== null ? state.message ?? "" : "").setScale(1);
    if (this.message) this.message.setScale(Math.min(1, width * 0.93 / Math.max(1, this.message.width)));
  }

  private drawFallback(state: AirHockeyState, pose: RinkPose): void {
    const graphics = this.fallback;
    if (!graphics) return;
    const { width, height } = this.scale;
    const available = height * (viewport.bottom - viewport.top);
    const scale = Math.min(width * 0.98 / state.arenaWidth, available * 0.98 / state.arenaHeight);
    const w = state.arenaWidth * scale;
    const h = state.arenaHeight * scale;
    const x = (width - w) / 2;
    const y = height * viewport.top + (available - h) / 2;
    const goal = state.goalSize * scale;
    const goalTop = y + (h - goal) / 2;
    const goalBottom = goalTop + goal;
    const left = Phaser.Display.Color.HexStringToColor(iceColors.left).color;
    const right = Phaser.Display.Color.HexStringToColor(iceColors.right).color;
    graphics.clear().fillStyle(0xa9bfce).fillRect(x, y, w, h);
    graphics.fillStyle(0x7ba9bc).fillRect(x, y, w / 2, h);
    graphics.fillStyle(0xbfa79a).fillRect(x + w / 2, y, w / 2, h);
    graphics.lineStyle(2, 0xeef7ff, 0.65).lineBetween(x + w / 2, y, x + w / 2, y + h)
      .strokeCircle(x + w / 2, y + h / 2, 111 * scale);
    graphics.lineStyle(4, 0x33475c).lineBetween(x, y, x + w, y).lineBetween(x, y + h, x + w, y + h);
    for (const [edge, color] of [[x, left], [x + w, right]]) {
      graphics.lineStyle(4, 0x33475c).lineBetween(edge, y, edge, goalTop).lineBetween(edge, goalBottom, edge, y + h);
      graphics.lineStyle(3, color).lineBetween(edge, goalTop, edge, goalBottom);
    }
    graphics.fillStyle(left).fillCircle(x + pose.leftX * scale, y + pose.leftY * scale, state.paddleRadius * scale);
    graphics.fillStyle(right).fillCircle(x + pose.rightX * scale, y + pose.rightY * scale, state.paddleRadius * scale);
    graphics.fillStyle(0x15212d).fillCircle(x + pose.puckX * scale, y + pose.puckY * scale, state.puckRadius * scale);
    graphics.lineStyle(1, 0xffe8b4).strokeCircle(x + pose.puckX * scale, y + pose.puckY * scale, state.puckRadius * scale);
  }
}

export const hostGame = {
  id: airHockeyManifest.id,
  displayName: airHockeyManifest.displayName,
  sceneKey: airHockeyManifest.hostView,
  scene: AirHockeyHostScene
} as const;
