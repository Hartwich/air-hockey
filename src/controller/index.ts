import type { ControllerLayoutKey } from "@open-party-lab/game-core";
import { airHockeyManifest } from "../manifest.js";

interface ReadyLayoutModel {
  currentPlayerReady: boolean;
  readyCount: number;
  playerCount: number;
  label: string;
  description: string;
  language?: "de" | "en";
  onToggleReady: () => void;
}

interface VirtualJoystickLayoutModel {
  kind: "virtual_joystick";
  title: string;
  subtitle: string;
  helperText: string;
  disabled: boolean;
  centerLabel: string;
  resetKey: string;
  stats: Array<{ label: string; value: string; highlighted?: boolean }>;
  ready?: ReadyLayoutModel;
  onMoveChange: (moveX: number, moveY: number) => void;
}

interface ControllerGameRenderContext {
  state: {
    preferredLanguage?: "de" | "en";
    room?: {
      language?: "de" | "en";
      selectedGameId?: string;
      availableGames?: Array<{ id: string; displayName?: string; roundCompletionMode?: string }>;
      players?: Array<{ id: string; name: string; isReady?: boolean }>;
    } | null;
    player?: {
      id: string;
      isReady?: boolean;
    } | null;
    game?: {
      phase?: string;
      message?: string;
      roundNumber?: number;
      state?: unknown;
    } | null;
  };
  onInput(input: unknown): void;
  onSetReady?: (isReady: boolean) => void;
}

interface AirHockeyControllerState {
  scoresByPlayer?: Record<string, number>;
  leftPlayerId?: string;
  rightPlayerId?: string;
  serveDirection?: "left" | "right";
  serveCountdownEndsAt?: number | null;
  message?: string;
}

function createAirHockeyMoveInput(playerId: string, moveX: number, moveY: number) {
  const magnitude = Math.hypot(moveX, moveY);
  const scale = magnitude > 1 ? 1 / magnitude : 1;

  return {
    type: "move" as const,
    playerId,
    moveX: moveX * scale,
    moveY: moveY * scale,
    sentAt: Date.now()
  };
}

function buildReadyModel(context: ControllerGameRenderContext): ReadyLayoutModel | undefined {
  const { state, onSetReady } = context;
  const gameId = state.room?.selectedGameId;
  const selectedGame = gameId ? state.room?.availableGames?.find((entry) => entry.id === gameId) : undefined;

  if (
    !selectedGame ||
    selectedGame.roundCompletionMode !== "wait_for_ready" ||
    state.game?.phase !== "finished" ||
    !state.room ||
    !state.player ||
    !onSetReady
  ) {
    return undefined;
  }

  const en = state.room.language === "en";
  const playerId = state.player.id;
  const players = state.room.players ?? [];
  const currentPlayerReady = Boolean(
    players.find((player) => player.id === playerId)?.isReady ?? state.player.isReady
  );
  const readyCount = players.filter((player) => player.isReady).length;
  const playerCount = players.length;

  return {
    currentPlayerReady,
    readyCount,
    playerCount,
    label: en ? "Next Round" : "Naechste Runde",
    description: en
      ? `${readyCount}/${playerCount} players are ready.`
      : `${readyCount}/${playerCount} Spieler sind bereit.`,
    language: state.room.language,
    onToggleReady: () => onSetReady(!currentPlayerReady)
  };
}

function buildAirHockeyControllerModel(context: ControllerGameRenderContext): VirtualJoystickLayoutModel {
  const en = context.state.room?.language === "en";
  const playerId = context.state.player?.id ?? "";
  const gameState = (context.state.game?.state ?? {}) as AirHockeyControllerState;
  const ownScore = gameState.scoresByPlayer?.[playerId] ?? 0;
  const opponentId =
    playerId === gameState.leftPlayerId ? gameState.rightPlayerId : gameState.leftPlayerId;
  const opponentScore = opponentId ? gameState.scoresByPlayer?.[opponentId] ?? 0 : 0;
  const sideLabel =
    playerId === gameState.leftPlayerId
      ? en
        ? "Defend the left goal"
        : "Linkes Tor verteidigen"
      : en
        ? "Defend the right goal"
        : "Rechtes Tor verteidigen";
  const countdownActive = gameState.serveCountdownEndsAt !== null && gameState.serveCountdownEndsAt !== undefined;
  const serveSide = gameState.serveDirection === "right" ? (en ? "right" : "rechts") : en ? "left" : "links";
  const countdownLabel = countdownActive ? (en ? `Serve to the ${serveSide}` : `Anstoss nach ${serveSide}`) : sideLabel;

  return {
    kind: "virtual_joystick",
    title: "Air Hockey",
    subtitle: context.state.game?.phase === "playing" ? countdownLabel : en ? "Get ready" : "Bereit machen",
    helperText:
      context.state.game?.message ??
      gameState.message ??
      (en
        ? "Guard your goal line and counter quickly."
        : "Halte die linke oder rechte Linie sauber und kontere schnell."),
    disabled: context.state.game?.phase !== "playing",
    centerLabel: "MOVE",
    resetKey: `${context.state.game?.roundNumber ?? 0}:${context.state.game?.phase ?? "idle"}`,
    stats: [
      {
        label: "Score",
        value: `${ownScore}:${opponentScore}`,
        highlighted: true
      }
    ],
    ready: buildReadyModel(context),
    onMoveChange: (moveX, moveY) => {
      if (!playerId) {
        return;
      }

      context.onInput(createAirHockeyMoveInput(playerId, moveX, moveY));
    }
  };
}

export const controllerGame = {
  id: airHockeyManifest.id,
  layoutKey: "virtual_joystick" as ControllerLayoutKey,
  buildLayout(context: ControllerGameRenderContext) {
    return buildAirHockeyControllerModel(context);
  }
} as const;

