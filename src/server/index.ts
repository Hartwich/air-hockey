import {
  createBaseRoundState,
  roundPhaseDurations,
  transitionRoundState,
  type ScoreEntry,
  type ServerGame,
  type ServerGameContext,
  type SupportedLanguage
} from "@open-party-lab/game-core";
import { airHockeyManifest } from "../manifest.js";
import type { AirHockeyInput, AirHockeyPaddleState, AirHockeyState } from "../protocol.js";
import { simulateRink } from "./physics.js";

const arenaWidth = 1_200;
const arenaHeight = 700;
const paddleRadius = 42;
const puckRadius = 22;
const goalSize = 320;
const targetScore = 5;
const serveCountdownMs = 3_000;
const serveSpeed = 640;
const serveSideSpeed = 115;
const idlePuckLimitMs = 4_000;

const airHockeyText = {
  de: {
    playerOne: "Spieler 1",
    playerTwo: "Spieler 2",
    playerFallback: "Spieler",
    intro: "Air Hockey: Verteidige dein Tor links oder rechts!",
    sideLeft: "links",
    sideRight: "rechts",
    serveCountdown: (secondsRemaining: number, sideLabel: string) =>
      `Anstoss in ${secondsRemaining} Sekunden nach ${sideLabel}.`,
    serveLaunch: (sideLabel: string) => `Anstoss nach ${sideLabel}!`,
    scores: (name: string) => `${name} trifft!`,
    wins: (name: string) => `${name} gewinnt die Runde!`
  },
  en: {
    playerOne: "Player 1",
    playerTwo: "Player 2",
    playerFallback: "Player",
    intro: "Air Hockey: Defend your goal on the left or right!",
    sideLeft: "left",
    sideRight: "right",
    serveCountdown: (secondsRemaining: number, sideLabel: string) =>
      `Face-off in ${secondsRemaining} seconds toward the ${sideLabel}.`,
    serveLaunch: (sideLabel: string) => `Face-off toward the ${sideLabel}!`,
    scores: (name: string) => `${name} scores!`,
    wins: (name: string) => `${name} wins the round!`
  },
  es: {
    playerOne: "Jugador 1", playerTwo: "Jugador 2", playerFallback: "Jugador",
    intro: "Air Hockey: ¡defiende tu portería a izquierda o derecha!", sideLeft: "izquierda", sideRight: "derecha",
    serveCountdown: (secondsRemaining: number, sideLabel: string) => `Saque en ${secondsRemaining} segundos hacia la ${sideLabel}.`,
    serveLaunch: (sideLabel: string) => `¡Saque hacia la ${sideLabel}!`,
    scores: (name: string) => `¡${name} marca!`, wins: (name: string) => `¡${name} gana la ronda!`
  },
  fr: {
    playerOne: "Joueur 1", playerTwo: "Joueur 2", playerFallback: "Joueur",
    intro: "Air Hockey : défendez votre but à gauche ou à droite !", sideLeft: "gauche", sideRight: "droite",
    serveCountdown: (secondsRemaining: number, sideLabel: string) => `Engagement dans ${secondsRemaining} secondes vers la ${sideLabel}.`,
    serveLaunch: (sideLabel: string) => `Engagement vers la ${sideLabel} !`,
    scores: (name: string) => `${name} marque !`, wins: (name: string) => `${name} remporte la manche !`
  },
  "pt-BR": {
    playerOne: "Jogador 1", playerTwo: "Jogador 2", playerFallback: "Jogador",
    intro: "Air Hockey: defenda seu gol à esquerda ou à direita!", sideLeft: "esquerda", sideRight: "direita",
    serveCountdown: (secondsRemaining: number, sideLabel: string) => `Reinício em ${secondsRemaining} segundos para a ${sideLabel}.`,
    serveLaunch: (sideLabel: string) => `Reinício para a ${sideLabel}!`,
    scores: (name: string) => `${name} marcou!`, wins: (name: string) => `${name} venceu a rodada!`
  }
} satisfies Record<SupportedLanguage, {
  playerOne: string;
  playerTwo: string;
  playerFallback: string;
  intro: string;
  sideLeft: string;
  sideRight: string;
  serveCountdown: (secondsRemaining: number, sideLabel: string) => string;
  serveLaunch: (sideLabel: string) => string;
  scores: (name: string) => string;
  wins: (name: string) => string;
}>;

function normalize(moveX: number, moveY: number): { x: number; y: number } {
  const magnitude = Math.hypot(moveX, moveY);

  if (!Number.isFinite(magnitude) || magnitude < 0.0001) {
    return { x: 0, y: 0 };
  }

  if (magnitude <= 1) {
    return { x: moveX, y: moveY };
  }

  return { x: moveX / magnitude, y: moveY / magnitude };
}

function createPaddles(
  statePlayers: Array<{ id: string; name: string; color: string }>,
  language: SupportedLanguage
): {
  paddles: Record<string, AirHockeyPaddleState>;
  leftPlayerId: string;
  rightPlayerId: string;
  scoresByPlayer: Record<string, number>;
} {
  const [first, second] = statePlayers;
  const leftPlayerId = first?.id ?? "p1";
  const rightPlayerId = second?.id ?? "p2";
  const text = airHockeyText[language];

  return {
    leftPlayerId,
    rightPlayerId,
    paddles: {
      [leftPlayerId]: {
        playerId: leftPlayerId,
        name: first?.name ?? text.playerOne,
        color: first?.color ?? "#60a5fa",
        x: arenaWidth * 0.23,
        y: arenaHeight / 2,
        inputX: 0,
        inputY: 0,
        vx: 0,
        vy: 0
      },
      [rightPlayerId]: {
        playerId: rightPlayerId,
        name: second?.name ?? text.playerTwo,
        color: second?.color ?? "#f97316",
        x: arenaWidth * 0.77,
        y: arenaHeight / 2,
        inputX: 0,
        inputY: 0,
        vx: 0,
        vy: 0
      }
    },
    scoresByPlayer: {
      [leftPlayerId]: 0,
      [rightPlayerId]: 0
    }
  };
}

function buildServeMessage(
  direction: "left" | "right",
  secondsRemaining: number,
  language: SupportedLanguage
): string {
  const text = airHockeyText[language];
  const sideLabel = direction === "right" ? text.sideRight : text.sideLeft;
  return text.serveCountdown(secondsRemaining, sideLabel);
}

function beginServeCountdown(
  state: AirHockeyState,
  now: number,
  direction: "left" | "right",
  language: SupportedLanguage
): AirHockeyState {
  return {
    ...state,
    puckX: arenaWidth / 2,
    puckY: arenaHeight / 2,
    puckVx: 0,
    puckVy: 0,
    puckIdleMs: 0,
    serveDirection: direction,
    serveCountdownEndsAt: now + serveCountdownMs,
    paddles: {
      ...state.paddles,
      [state.leftPlayerId]: {
        ...state.paddles[state.leftPlayerId],
        x: arenaWidth * 0.23,
        y: arenaHeight / 2,
        inputX: 0,
        inputY: 0,
        vx: 0,
        vy: 0
      },
      [state.rightPlayerId]: {
        ...state.paddles[state.rightPlayerId],
        x: arenaWidth * 0.77,
        y: arenaHeight / 2,
        inputX: 0,
        inputY: 0,
        vx: 0,
        vy: 0
      }
    },
    message: buildServeMessage(direction, Math.ceil(serveCountdownMs / 1000), language),
    updatedAt: now
  };
}

function launchServe(state: AirHockeyState, now: number, language: SupportedLanguage): AirHockeyState {
  const serveTowardRight = state.serveDirection === "right";
  const text = airHockeyText[language];
  const sideLabel = serveTowardRight ? text.sideRight : text.sideLeft;

  return {
    ...state,
    puckVx: serveTowardRight ? serveSpeed : -serveSpeed,
    puckVy: serveTowardRight ? serveSideSpeed : -serveSideSpeed,
    serveCountdownEndsAt: null,
    message: text.serveLaunch(sideLabel),
    updatedAt: now
  };
}

function buildScore(state: AirHockeyState, context: ServerGameContext): ScoreEntry[] {
  return state.winnerPlayerId ? [{ playerId: state.winnerPlayerId, delta: 1, reason: context.language === "en" ? "Air Hockey win" : "Air Hockey Sieg" }] : [];
}

export const serverGame: ServerGame<AirHockeyState, AirHockeyInput> = {
  manifest: airHockeyManifest,
  createInitialState(context) {
    const setup = createPaddles(context.players, context.language);
    return {
      ...createBaseRoundState("round_intro", context.now, {
        durationMs: roundPhaseDurations.roundIntroMs,
        message: airHockeyText[context.language].intro
      }),
      arenaWidth,
      arenaHeight,
      puckX: arenaWidth / 2,
      puckY: arenaHeight / 2,
      puckVx: 0,
      puckVy: 0,
      paddleRadius,
      puckRadius,
      goalSize,
      targetScore,
      tick: 0,
      leftPlayerId: setup.leftPlayerId,
      rightPlayerId: setup.rightPlayerId,
      serveDirection: "right",
      serveCountdownEndsAt: null,
      paddles: setup.paddles,
      scoresByPlayer: setup.scoresByPlayer
    };
  },
  startRound(state, context) {
    const setup = createPaddles(context.players, context.language);
    const nextState = transitionRoundState(
      {
        ...state,
        leftPlayerId: setup.leftPlayerId,
        rightPlayerId: setup.rightPlayerId,
        paddles: setup.paddles,
        scoresByPlayer: setup.scoresByPlayer,
        winnerPlayerId: undefined,
        tick: 0,
        serveDirection: "right",
        serveCountdownEndsAt: null,
        puckX: arenaWidth / 2,
        puckY: arenaHeight / 2,
        puckVx: 0,
        puckVy: 0
      },
      "playing",
      context.now,
      {
        startedAt: context.now,
        message: buildServeMessage("right", 3, context.language)
      }
    ) as AirHockeyState;

    return beginServeCountdown(nextState, context.now, "right", context.language);
  },
  onPause(state) {
    return { ...state, paddles: Object.fromEntries(Object.entries(state.paddles).map(([id, paddle]) =>
      [id, { ...paddle, inputX: 0, inputY: 0, vx: 0, vy: 0 }])) };
  },
  handleInput(state, input) {
    if (state.phase !== "playing" || input.type !== "move") {
      return state;
    }

    const paddle = state.paddles[input.playerId];

    if (!paddle) {
      return state;
    }

    const normalized = normalize(input.moveX, input.moveY);

    return {
      ...state,
      paddles: {
        ...state.paddles,
        [input.playerId]: {
          ...paddle,
          inputX: normalized.x,
          inputY: normalized.y
        }
      },
      updatedAt: input.sentAt
    };
  },
  tick(state, deltaMs, context) {
    if (state.phase !== "playing") {
      return state;
    }

    if (state.serveCountdownEndsAt !== null) {
      if (context.now < state.serveCountdownEndsAt) {
        const remainingSeconds = Math.max(
          1,
          Math.ceil((state.serveCountdownEndsAt - context.now) / 1000)
        );
        const countdownMessage = buildServeMessage(state.serveDirection, remainingSeconds, context.language);

        if (state.message === countdownMessage) {
          return state;
        }

        return {
          ...state,
          message: countdownMessage,
          updatedAt: context.now
        };
      }

      return launchServe(state, context.now, context.language);
    }

    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return state;
    }

    const { goal, ...physics } = simulateRink(state, deltaMs / 1000);
    const tick = state.tick + 1;
    const nextServeDirection = state.serveDirection === "right" ? "left" : "right";
    if (goal) {
      const scorerId = goal === "left" ? state.rightPlayerId : state.leftPlayerId;
      const nextScore = (state.scoresByPlayer[scorerId] ?? 0) + 1;
      const nextState: AirHockeyState = {
        ...state,
        ...physics,
        tick,
        scoresByPlayer: {
          ...state.scoresByPlayer,
          [scorerId]: nextScore
        },
        serveDirection: nextServeDirection,
        serveCountdownEndsAt: null,
        message: airHockeyText[context.language].scores(
          state.paddles[scorerId]?.name ?? airHockeyText[context.language].playerFallback
        )
      };

      if (nextScore >= state.targetScore) {
        return transitionRoundState(
          {
            ...nextState,
            winnerPlayerId: scorerId
          },
          "locked",
          context.now,
          {
            durationMs: roundPhaseDurations.lockedMs,
            message: airHockeyText[context.language].wins(
              state.paddles[scorerId]?.name ?? airHockeyText[context.language].playerFallback
            )
          }
        );
      }

      return beginServeCountdown(nextState, context.now, nextServeDirection, context.language);
    }

    const puckIdleMs = Math.hypot(physics.puckVx, physics.puckVy) < 14
      ? (state.puckIdleMs ?? 0) + Math.min(deltaMs, 250)
      : 0;
    const nextState = {
      ...state,
      ...physics,
      puckIdleMs,
      tick,
      updatedAt: context.now
    };
    return puckIdleMs >= idlePuckLimitMs
      ? beginServeCountdown(nextState, context.now, nextServeDirection, context.language)
      : nextState;
  },
  isRoundFinished(state) {
    return state.phase === "locked";
  },
  buildScore
};
