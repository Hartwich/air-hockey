# Air Hockey

Two-player arcade air hockey for Open Party Lab with phone joystick controls.

![In-game screenshot](docs/screenshots/host.png)

## Status

Alpha. The 1v1 puck loop is playable. Needs physics tuning, touch-control balancing, and match-end polish.

## Run Through Open Party Lab

This repo is not a standalone app. Run it through the Open Party Lab platform.

Recommended layout:

```text
Open-Party-Lab/
  local-games/
    air-hockey/
```

From the Platform repo:

```bash
npm install
npm run games:sync-local
npm run dev:all
```

The Platform loads this game only when the repo exists locally and `npm run games:sync-local` links it. Missing optional games are skipped.

## GitHub Metadata

Description:

```text
Two-player arcade air hockey for Open Party Lab with phone joystick controls.
```

Suggested topics:

```text
open-party-lab party-game browser-game phaser typescript local-multiplayer air-hockey
```

## Package Entrypoints

- `@open-party-lab/game-air-hockey/manifest`
- `@open-party-lab/game-air-hockey/protocol`
- `@open-party-lab/game-air-hockey/server`
- `@open-party-lab/game-air-hockey/host`
- `@open-party-lab/game-air-hockey/controller`

The Platform should import only these public entrypoints.

## Development Checks

```bash
npm install
npm run typecheck
npm run build
npm run pack:dry-run
```

For visual checks, start Open Party Lab, add virtual controllers when needed, and capture host screenshots through a browser.

## License

Code is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

Assets, generated media, word lists, prompts, and third-party references may need separate rights review before public store distribution.
