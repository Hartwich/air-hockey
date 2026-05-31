# Open Party Lab: Air Hockey

Air Hockey is an Open Party Lab game package. Two players steer virtual paddles from their phones and try to shoot the puck into the opponent's goal on the shared host screen.

## Local Development

Recommended folder layout:

```text
Open-Party-Lab/
  local-games/
    air-hockey/
```

Install and build this game:

```bash
npm install
npm run typecheck
npm run build
```

For local Platform integration, run this in the Party Platform repo:

```bash
cd ../..
npm run games:sync-local
npm run dev:all
```

The Platform links only game repos that exist locally. If this repo is not present, Air Hockey is skipped.

## Public Entrypoints

```text
@open-party-lab/game-air-hockey/manifest
@open-party-lab/game-air-hockey/protocol
@open-party-lab/game-air-hockey/server
@open-party-lab/game-air-hockey/host
@open-party-lab/game-air-hockey/controller
```

## Browser Note

Chromium-based browsers and Safari are recommended for phone controllers. Firefox may have issues around fullscreen, reconnect/session handling, or touch timing.

