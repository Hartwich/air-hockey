import { clamp, type AirHockeyPaddleState, type AirHockeyState } from "../protocol.js";

const maxStep = 1 / 240;
const paddleSpeed = 660;
const puckMaxSpeed = 1_450;
const railRestitution = 0.92;
const paddleRestitution = 0.90;
const separation = 0.001;

type Goal = "left" | "right";
type Body = { x: number; y: number; vx: number; vy: number };
type Contact = { time: number; nx: number; ny: number; vx: number; vy: number; restitution: number; depth: number };

function movePaddle(paddle: AirHockeyPaddleState, state: AirHockeyState, dt: number): Body {
  const radius = state.paddleRadius;
  const xMin = paddle.playerId === state.leftPlayerId ? radius : state.arenaWidth / 2 + radius;
  const xMax = paddle.playerId === state.leftPlayerId ? state.arenaWidth / 2 - radius : state.arenaWidth - radius;
  const dvx = paddle.inputX * paddleSpeed - (paddle.vx ?? 0);
  const dvy = paddle.inputY * paddleSpeed - (paddle.vy ?? 0);
  const acceleration = paddle.inputX || paddle.inputY ? 7_600 : 12_000;
  const scale = Math.min(1, acceleration * dt / Math.max(Math.hypot(dvx, dvy), 1e-6));
  const vx = (paddle.vx ?? 0) + dvx * scale;
  const vy = (paddle.vy ?? 0) + dvy * scale;
  return {
    x: paddle.x,
    y: paddle.y,
    vx: (clamp(paddle.x + vx * dt, xMin, xMax) - paddle.x) / dt,
    vy: (clamp(paddle.y + vy * dt, radius, state.arenaHeight - radius) - paddle.y) / dt
  };
}

function movePuck(puck: Body, paddles: Body[], state: AirHockeyState, dt: number): Goal | null {
  const { puckRadius: radius, arenaWidth: width, arenaHeight: height } = state;
  const goalTop = (height - state.goalSize) / 2;
  const goalBottom = height - goalTop;
  let remaining = dt;
  let elapsed = 0;

  // Resolve the first time of impact. Remaining travel can include a second
  // hit, e.g. a paddle sending the puck immediately into the side rail.
  for (let iteration = 0; iteration < 8 && remaining > 1e-7; iteration += 1) {
    let contact: Contact = { time: remaining, nx: 0, ny: 0, vx: 0, vy: 0, restitution: 0, depth: 0 };
    const circle = (x: number, y: number, vx: number, vy: number, distance: number, restitution: number) => {
      const dx = puck.x - x;
      const dy = puck.y - y;
      const ux = puck.vx - vx;
      const uy = puck.vy - vy;
      const approach = dx * ux + dy * uy;
      const speedSq = ux * ux + uy * uy;
      const gap = dx * dx + dy * dy - distance * distance;
      const discriminant = approach * approach - speedSq * gap;
      const time = gap < 0 ? 0 : approach < 0 && discriminant >= 0
        ? Math.max(0, (-approach - Math.sqrt(discriminant)) / speedSq)
        : Infinity;
      if (time >= contact.time) return;

      const hitX = dx + ux * time;
      const hitY = dy + uy * time;
      const length = Math.hypot(hitX, hitY);
      const nx = length > 1e-7 ? hitX / length : 0;
      const ny = length > 1e-7 ? hitY / length : 1;
      contact = { time, nx, ny, vx, vy, restitution, depth: Math.max(0, distance - length) };
    };

    const rail = (gap: number, nx: number, ny: number, endRail = false) => {
      const approach = puck.vx * nx + puck.vy * ny;
      const time = gap < 0 ? 0 : approach < 0 ? gap / -approach : Infinity;
      if (time >= contact.time) return;
      const y = puck.y + puck.vy * time;
      if (endRail && y > goalTop && y < goalBottom) return;
      contact = { time, nx, ny, vx: 0, vy: 0, restitution: railRestitution, depth: Math.max(0, -gap) };
    };

    rail(puck.y - radius, 0, 1);
    rail(height - radius - puck.y, 0, -1);
    // Once the puck has entered a mouth, only the post caps can touch it
    // from this side of the goal line.
    rail(puck.x - radius, 1, 0, true);
    rail(width - radius - puck.x, -1, 0, true);
    for (const x of [0, width]) {
      circle(x, goalTop, 0, 0, radius, railRestitution);
      circle(x, goalBottom, 0, 0, radius, railRestitution);
    }
    for (const paddle of paddles) {
      circle(paddle.x + paddle.vx * elapsed, paddle.y + paddle.vy * elapsed,
        paddle.vx, paddle.vy, radius + state.paddleRadius, paddleRestitution);
    }

    const endX = puck.x + puck.vx * contact.time;
    // Score as soon as the whole puck crosses the line, after any earlier
    // post or paddle collision has had a chance to intercept it.
    if (endX <= -radius || endX >= width + radius) {
      const goal = endX <= -radius ? "left" : "right";
      const x = goal === "left" ? -radius : width + radius;
      const crossingY = puck.y + puck.vy * clamp((x - puck.x) / puck.vx, 0, contact.time);
      if (crossingY > goalTop && crossingY < goalBottom) {
        puck.x = x;
        puck.y = crossingY;
        return goal;
      }
    }

    puck.x = endX + contact.nx * (contact.depth + separation);
    puck.y += puck.vy * contact.time + contact.ny * (contact.depth + separation);
    // An overlap correction can occur when a paddle pins the puck against a
    // rail. Only actual travel, never that correction, can cross the goal line.
    puck.y = clamp(puck.y, radius, height - radius);
    const outsideMouth = puck.y <= goalTop || puck.y >= goalBottom;
    const edge = outsideMouth ? radius : -radius + separation;
    puck.x = clamp(puck.x, edge, width - edge);
    elapsed += contact.time;
    remaining -= contact.time;
    const relativeNormal = (puck.vx - contact.vx) * contact.nx + (puck.vy - contact.vy) * contact.ny;
    if (relativeNormal < 0) {
      const impulse = -(1 + contact.restitution) * relativeNormal;
      puck.vx += impulse * contact.nx;
      puck.vy += impulse * contact.ny;
      const scale = Math.min(1, puckMaxSpeed / Math.hypot(puck.vx, puck.vy));
      puck.vx *= scale;
      puck.vy *= scale;
    }
  }

  const speed = Math.hypot(puck.vx, puck.vy);
  const glide = Math.max(0, Math.exp(-0.16 * dt) - 12 * dt / Math.max(speed, 1e-6));
  puck.vx *= glide;
  puck.vy *= glide;
  return null;
}

export function simulateRink(state: AirHockeyState, seconds: number) {
  const duration = clamp(seconds, 0, 0.25);
  const steps = Math.ceil(duration / maxStep);
  const dt = duration / steps;
  const puck = { x: state.puckX, y: state.puckY, vx: state.puckVx, vy: state.puckVy };
  const players = Object.values(state.paddles).map(paddle => ({ ...paddle }));
  let goal: Goal | null = null;

  for (let step = 0; step < steps && !goal; step += 1) {
    const trajectories = players.map(paddle => movePaddle(paddle, state, dt));
    goal = movePuck(puck, trajectories, state, dt);
    players.forEach((paddle, i) => {
      const body = trajectories[i];
      paddle.x += body.vx * dt;
      paddle.y += body.vy * dt;
      paddle.vx = body.vx;
      paddle.vy = body.vy;
    });
  }

  return {
    goal,
    puckX: puck.x, puckY: puck.y, puckVx: puck.vx, puckVy: puck.vy,
    paddles: Object.fromEntries(players.map(paddle => [paddle.playerId, paddle]))
  };
}
