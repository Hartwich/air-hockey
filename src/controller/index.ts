import type { ControllerLayoutKey, SupportedLanguage } from "@open-party-lab/game-core";
import { airHockeyManifest } from "../manifest.js";

interface ReadyLayoutModel {
  currentPlayerReady: boolean;
  readyCount: number;
  playerCount: number;
  label: string;
  description: string;
  language?: SupportedLanguage;
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
    preferredLanguage?: SupportedLanguage;
    room?: {
      language?: SupportedLanguage;
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

  const words = {
    de: { next: "Nächste Runde", ready: "Spieler sind bereit." }, en: { next: "Next Round", ready: "players are ready." },
    es: { next: "Siguiente ronda", ready: "jugadores listos." }, fr: { next: "Manche suivante", ready: "joueurs sont prêts." }, "pt-BR": { next: "Próxima rodada", ready: "jogadores estão prontos." }
  }[state.room.language ?? "de"];
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
    label: words.next,
    description: `${readyCount}/${playerCount} ${words.ready}`,
    language: state.room.language,
    onToggleReady: () => onSetReady(!currentPlayerReady)
  };
}

function buildAirHockeyControllerModel(context: ControllerGameRenderContext): VirtualJoystickLayoutModel {
  const words = {
    de: { left: "Linkes Tor verteidigen", right: "Rechtes Tor verteidigen", l: "links", r: "rechts", serve: "Anstoß nach", ready: "Bereit machen", guard: "Halte die linke oder rechte Linie sauber und kontere schnell." },
    en: { left: "Defend the left goal", right: "Defend the right goal", l: "left", r: "right", serve: "Serve to the", ready: "Get ready", guard: "Guard your goal line and counter quickly." },
    es: { left: "Defiende la portería izquierda", right: "Defiende la portería derecha", l: "izquierda", r: "derecha", serve: "Saque hacia la", ready: "Prepárate", guard: "Protege tu portería y contraataca rápido." },
    fr: { left: "Défends le but gauche", right: "Défends le but droit", l: "gauche", r: "droite", serve: "Engagement vers la", ready: "Prépare-toi", guard: "Protège ton but et contre-attaque rapidement." },
    "pt-BR": { left: "Defenda o gol esquerdo", right: "Defenda o gol direito", l: "esquerda", r: "direita", serve: "Reinício para a", ready: "Prepare-se", guard: "Proteja seu gol e contra-ataque rápido." }
  }[context.state.room?.language ?? context.state.preferredLanguage ?? "de"];
  const playerId = context.state.player?.id ?? "";
  const gameState = (context.state.game?.state ?? {}) as AirHockeyControllerState;
  const ownScore = gameState.scoresByPlayer?.[playerId] ?? 0;
  const opponentId =
    playerId === gameState.leftPlayerId ? gameState.rightPlayerId : gameState.leftPlayerId;
  const opponentScore = opponentId ? gameState.scoresByPlayer?.[opponentId] ?? 0 : 0;
  const sideLabel =
    playerId === gameState.leftPlayerId
      ? words.left
      : words.right;
  const countdownActive = gameState.serveCountdownEndsAt !== null && gameState.serveCountdownEndsAt !== undefined;
  const serveSide = gameState.serveDirection === "right" ? words.r : words.l;
  const countdownLabel = countdownActive ? `${words.serve} ${serveSide}` : sideLabel;

  return {
    kind: "virtual_joystick",
    title: airHockeyManifest.translations[context.state.room?.language ?? context.state.preferredLanguage ?? "de"].displayName,
    subtitle: context.state.game?.phase === "playing" ? countdownLabel : words.ready,
    helperText:
      context.state.game?.message ??
      gameState.message ??
      words.guard,
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

