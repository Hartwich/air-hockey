import Phaser from "phaser";
import { airHockeyManifest } from "../manifest.js";
import { renderRoundScreens } from "./roundScreens.js";
import { tokens } from "./platformTheme.js";

interface HostClientLike {
  subscribe(callback: (state: HostAppStateLike) => void): () => void;
}

interface HostAppStateLike {
  game?: {
    state?: unknown;
  } | null;
  room?: {
    language?: "de" | "en";
  } | null;
}

interface AirHockeyHostState {
  arenaWidth: number;
  arenaHeight: number;
  puckX: number;
  puckY: number;
  puckRadius: number;
  paddleRadius: number;
  goalSize: number;
  paddles: Record<string, { playerId: string; name: string; color: string; x: number; y: number }>;
  scoresByPlayer: Record<string, number>;
  leftPlayerId: string;
  rightPlayerId: string;
  serveDirection: "left" | "right";
  serveCountdownEndsAt: number | null;
  message?: string;
}

const hostTheme = {
  bodyFont: '"Nunito Sans", sans-serif'
};

export class AirHockeyHostScene extends Phaser.Scene {
  private unsubscribe?: () => void;
  private rinkGraphics?: Phaser.GameObjects.Graphics;
  private actorsGraphics?: Phaser.GameObjects.Graphics;
  private infoText?: Phaser.GameObjects.Text;

  constructor() {
    super(airHockeyManifest.hostView);
  }

  create(): void {
    const client = this.registry.get("hostClient") as HostClientLike;

    this.cameras.main.setBackgroundColor(tokens().color.background);
    this.rinkGraphics = this.add.graphics();
    this.actorsGraphics = this.add.graphics();
    this.infoText = this.add.text(32, 28, "", {
      fontFamily: hostTheme.bodyFont,
      fontSize: "30px",
      color: tokens().color.textSoft
    });

    this.unsubscribe = client.subscribe((state) => {
      // Intro and result screens belong to this game, not the platform.
      if (renderRoundScreens(this, state)) {
        return;
      }

      const gameState = (state.game?.state ?? null) as AirHockeyHostState | null;
      const en = state.room?.language === "en";

      if (!gameState || !this.rinkGraphics || !this.actorsGraphics || !this.infoText) {
        return;
      }

      const padding = 48;
      const drawWidth = this.scale.width - padding * 2;
      const drawHeight = this.scale.height - padding * 2;
      const scale = Math.min(drawWidth / gameState.arenaWidth, drawHeight / gameState.arenaHeight);
      const offsetX = (this.scale.width - gameState.arenaWidth * scale) / 2;
      const offsetY = (this.scale.height - gameState.arenaHeight * scale) / 2;

      const toScreenX = (x: number) => offsetX + x * scale;
      const toScreenY = (y: number) => offsetY + y * scale;

      this.rinkGraphics.clear();
      this.rinkGraphics.fillStyle(0x0b1220, 1);
      this.rinkGraphics.fillRect(offsetX, offsetY, gameState.arenaWidth * scale, gameState.arenaHeight * scale);
      this.rinkGraphics.lineStyle(4, 0x38bdf8, 0.6);
      this.rinkGraphics.strokeRect(offsetX, offsetY, gameState.arenaWidth * scale, gameState.arenaHeight * scale);
      this.rinkGraphics.lineStyle(3, 0x94a3b8, 0.45);
      this.rinkGraphics.lineBetween(
        offsetX + (gameState.arenaWidth * scale) / 2,
        offsetY,
        offsetX + (gameState.arenaWidth * scale) / 2,
        offsetY + gameState.arenaHeight * scale
      );

      const goalHeight = gameState.goalSize * scale;
      const goalTop = offsetY + (gameState.arenaHeight * scale - goalHeight) / 2;
      this.rinkGraphics.fillStyle(0x22d3ee, 0.35);
      this.rinkGraphics.fillRect(offsetX - 8, goalTop, 8, goalHeight);
      this.rinkGraphics.fillRect(offsetX + gameState.arenaWidth * scale, goalTop, 8, goalHeight);

      this.actorsGraphics.clear();
      this.actorsGraphics.fillStyle(0xffffff, 0.95);
      this.actorsGraphics.fillCircle(
        toScreenX(gameState.puckX),
        toScreenY(gameState.puckY),
        gameState.puckRadius * scale
      );

      for (const paddle of Object.values(gameState.paddles)) {
        this.actorsGraphics.fillStyle(Phaser.Display.Color.HexStringToColor(paddle.color).color, 0.95);
        this.actorsGraphics.fillCircle(toScreenX(paddle.x), toScreenY(paddle.y), gameState.paddleRadius * scale);
      }

      const leftName = gameState.paddles[gameState.leftPlayerId]?.name ?? (en ? "Left" : "Links");
      const rightName = gameState.paddles[gameState.rightPlayerId]?.name ?? (en ? "Right" : "Rechts");
      const leftScore = gameState.scoresByPlayer[gameState.leftPlayerId] ?? 0;
      const rightScore = gameState.scoresByPlayer[gameState.rightPlayerId] ?? 0;
      const scoreLine = `${leftName} ${leftScore} : ${rightScore} ${rightName}`;
      const detail = gameState.message ? `\n${gameState.message}` : "";
      this.infoText.setText(`${scoreLine}${detail}`);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.rinkGraphics?.destroy();
      this.rinkGraphics = undefined;
      this.actorsGraphics?.destroy();
      this.actorsGraphics = undefined;
      this.infoText?.destroy();
      this.infoText = undefined;
    });
  }
}

export const hostGame = {
  id: airHockeyManifest.id,
  displayName: airHockeyManifest.displayName,
  sceneKey: airHockeyManifest.hostView,
  scene: AirHockeyHostScene
} as const;

