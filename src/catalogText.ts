import type { LocalizedGameTextMap } from "@open-party-lab/game-core";

export const airHockeyText = {
  "de": {
    "displayName": "Air Hockey",
    "description": "Duelle dich im 1v1 und schiesse den Puck ins gegnerische Tor.",
    "visual": {
      "eyebrow": "Duelle"
    }
  },
  "en": {
    "displayName": "Air Hockey",
    "description": "Face off in a one-on-one duel and shoot the puck into your opponent’s goal.",
    "visual": {
      "eyebrow": "Duel"
    }
  }
} as const satisfies LocalizedGameTextMap;
