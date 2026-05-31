import type { GameManifest } from "@open-party-lab/game-core";

export const airHockeyManifest = {
  id: "air-hockey",
  displayName: "Air Hockey",
  description: "Duelle dich im 1v1 und schiesse den Puck ins gegnerische Tor.",
  minPlayers: 2,
  maxPlayers: 2,
  hostView: "AirHockeyHostScene",
  controllerView: "air-hockey",
  controllerLayout: "virtual_joystick",
  supportsTeams: false,
  estimatedRoundDurationMs: 60_000,
  roundCompletionMode: "wait_for_ready",
  phaseDurations: {
    roundIntroMs: 0,
    countdownMs: 0
  }
} as const satisfies GameManifest;

export const manifest = airHockeyManifest;

