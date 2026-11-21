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
  },
  "es": {
    "displayName": "Air Hockey",
    "description": "Compite en un duelo uno contra uno y mete el disco en la portería rival.",
    "visual": { "eyebrow": "Duelo" }
  },
  "fr": {
    "displayName": "Air Hockey",
    "description": "Affrontez-vous en duel et envoyez le palet dans le but adverse.",
    "visual": { "eyebrow": "Duel" }
  },
  "pt-BR": {
    "displayName": "Air Hockey",
    "description": "Encare um duelo mano a mano e acerte o disco no gol adversário.",
    "visual": { "eyebrow": "Duelo" }
  }
} as const satisfies LocalizedGameTextMap;
