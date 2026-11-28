// Builds the agent-team explainer: node docs/explainers/agent-team/build.mjs [--light]
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ANATOMY = join(homedir(), ".agents/skills/anatomy");
const k = await import(pathToFileURL(join(ANATOMY, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(ANATOMY, "scripts/inline-kit.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 780;
const HEIGHT = 440;

const PLATE = { x: -238, y: -72, w: 476, d: 144, r: 10 };
const PLATE_H = 12;
const FOOT_H = 5;

const HOP = { x: -232, y: -30, w: 48, d: 56, r: 3 };
const HOP_H = 36;
const CARD = { w: 16, d: 12, h: 1.2 };
const CAR = { x: -12, y: -10, w: 24, d: 20, r: 2 };
const CAR_TOP = 8;
const CARD_TOP = CAR_TOP + CARD.h;

const START_X = -150;
const BUILD_FRAMES = [-164, -66];
const BUILD_BEAM_Z = 53;
const HEADS = [-150, -133, -115, -98, -81];
const ACTIVE_HEAD = 2;
const PAD_Z = 28;
const STAMP = PAD_Z - CARD_TOP;

const CHECK_FRAMES = [-52, 96];
const CHECK_BEAM_Z = 45;
const CI = ["format:check", "lint", "typecheck", "test", "build", "knip", "db", "e2e", "storybook"];
const CI_X = CI.map((_, i) => -40 + i * 7.5);
const PIN_REST = 14;
const AGENTS = ["review-agent", "qa-agent", "spec-compliance", "architecture-audit"];
const AGENT_X = [36, 52, 68, 84];
const FOOT_REST = 16;
const GATE_X = 108;
const GATE_LIFT = 16;
const POINTS = [114, 0];

const MAIN_BIN = { x: 176, y: -22, w: 46, d: 44, r: 2 };
const INT_BIN = { x: 178, y: 28, w: 44, d: 32, r: 2 };
const WALL = 2;
const WALL_H = 8;
const MAIN_STACK = [MAIN_BIN.x + MAIN_BIN.w / 2, 0];
const INT_STACK = [INT_BIN.x + 14, INT_BIN.y + INT_BIN.d / 2 - 2];
const SLOTS = 8;

const MAIN_PATH = [[START_X, 0], [156, 0]];
const SPUR_PATH = [[START_X, 0], [POINTS[0] - 2, 0], [140, 43], [154, 43]];

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-150, 0, BUILD_BEAM_Z + 6], [CHECK_FRAMES[1], 22, CHECK_BEAM_Z + 6]],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 40 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const line3 = (points) => k.pathOf(points.map(at));
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

/** A bar of width `width` from a to b on the floor, as an extruded convex ring. */
function bar([ax, ay], [bx, by], width, z, height) {
  const len = Math.hypot(bx - ax, by - ay);
  const nx = (-(by - ay) / len) * (width / 2);
  const ny = ((bx - ax) / len) * (width / 2);
  return k.extrude([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]], z, height, P, { convex: true });
}

function offsetPath(points, by) {
  return points.map(([x, y], i) => {
    const [px, py] = points[Math.max(0, i - 1)];
    const [qx, qy] = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(qx - px, qy - py);
    return [x + (-(qy - py) / len) * by, y + ((qx - px) / len) * by];
  });
}

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6.2, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 11);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  const strip = { x: -150, y: 58, w: 300, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  const label = { x: -226, y: 38, w: 40, d: 18, r: 1.5 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3, 0.3), { tone: "lo" }));
  for (const y of [43, 47, 51]) out.push(L(k.lineOnTop([label.x + 5, y], [label.x + (y === 51 ? 22 : 34), y], 0.8, P), { tone: "faint", free: "both" }));
  out.push(D(k.corners(label, 2.2).map(([x, y]) => at([x, y, 0.8])), { size: 0.4 }));
  return out.join("");
}

function track() {
  const out = [];
  const sleepers = [];
  for (let x = -164; x <= 162; x += 9) sleepers.push([[x, -10], [x, 10]]);
  const [s0, s1] = [SPUR_PATH[2], SPUR_PATH[3]];
  const [j0] = [SPUR_PATH[1]];
  const spurLen = Math.hypot(s0[0] - j0[0], s0[1] - j0[1]);
  for (let t = 9; t < spurLen; t += 9) {
    const x = j0[0] + ((s0[0] - j0[0]) * t) / spurLen;
    const y = j0[1] + ((s0[1] - j0[1]) * t) / spurLen;
    const nx = -(s0[1] - j0[1]) / spurLen, ny = (s0[0] - j0[0]) / spurLen;
    if (y > 12) sleepers.push([[x - nx * 10, y - ny * 10], [x + nx * 10, y + ny * 10]]);
  }
  for (let x = s0[0] + 6; x <= s1[0] + 6; x += 9) sleepers.push([[x, 33], [x, 53]]);
  for (const [a, b] of sleepers) out.push(S(bar(a, b, 3.2, 0, 1), { tone: "lo", crease: "none" }));
  for (const side of [-6, 6]) {
    out.push(S(k.slabOf({ x: -166, y: side - 1, w: 332, d: 2, r: 0.4 }, 1, 1.6, P, 2), { tone: "mid", crease: "none" }));
    const rail = offsetPath(SPUR_PATH.slice(1), side);
    for (let i = 0; i < rail.length - 1; i++) out.push(S(bar(rail[i], rail[i + 1], 2, 1, 1.6), { tone: "mid", crease: "none" }));
  }
  for (const [x, y] of [[166, 0], [160, 43]]) {
    out.push(S(k.slabOf({ x, y: y - 9, w: 5, d: 18, r: 1 }, 0, 7, P, 3, 0.4), { tone: "mid" }));
    out.push(D([at([x + 2.5, y - 6, 7]), at([x + 2.5, y + 6, 7])], { size: 0.45 }));
  }
  out.push(S(k.cylinder(POINTS[0], POINTS[1], 4.4, 2.6, 0.8, P, 28), { tone: "lo" }));
  out.push(D([at([POINTS[0], POINTS[1], 3.4])], { size: 0.6, tone: "hi" }));
  return out.join("");
}

function hopper() {
  const out = [`<path class="iso-halo" d="${k.haloOf(HOP, 0, HOP_H, P)}"/>`];
  out.push(S(k.slabOf(HOP, 0, HOP_H, P, 6, 1), { tone: "mid" }));
  const front = HOP.y + HOP.d;
  for (const z of [12, 24]) out.push(L(k.ringSeam(k.ringOf(HOP, 6), z, P), { tone: "lo" }));
  for (const z of [6, 18, 30]) {
    out.push(S(k.slabOf({ x: HOP.x + HOP.w / 2 - 6, y: front, w: 12, d: 2.4, r: 0.8 }, z - 1.2, 2.4, P, 3), { tone: "mid" }));
  }
  for (const z of [3, 15, 27]) out.push(D([at([HOP.x + 4, front, z + 6]), at([HOP.x + HOP.w - 4, front, z + 6])], { size: 0.4 }));
  const side = HOP.x + HOP.w;
  for (let i = 0; i < 5; i++) out.push(S(k.slabOf({ x: side, y: HOP.y + 12, w: 0.6, d: HOP.d - 24, r: 0.3 }, 9 + i * 4.4, 1.4, P, 2), { tone: "lo", crease: "none" }));
  const well = { x: HOP.x + 6, y: HOP.y + 8, w: 28, d: 24, r: 1.5 };
  out.push(L(k.planOutline(well, HOP_H, P, 3), { tone: "lo" }));
  for (let i = 0; i < 5; i++) {
    const plan = { x: well.x + 6 + (i % 2) * 0.6, y: well.y + 6, w: CARD.w, d: CARD.d, r: 0.6 };
    out.push(S(k.slabOf(plan, HOP_H + i * 1.3, CARD.h, P, 2), { tone: "hi", crease: "lo" }));
  }
  out.push(k.faceTextSvg(k.sideMatrix([HOP.x + 6, front], 33.2, P, "left"), "ramble-pm", { size: 4.6, tone: "mid" }));
  out.push(`<g data-part="ledger-count">${k.faceTextSvg(k.sideMatrix([HOP.x + 6, front], 9.4, P, "left"), "91 open", { size: 3.6, tone: "mid" })}</g>`);
  out.push(`<g data-part="ledger-lamp">${D([at([HOP.x + HOP.w - 7, HOP.y + HOP.d - 7, HOP_H])], { size: 1.2, tone: "mid" })}</g>`);
  out.push(L(k.ring(HOP.x + HOP.w - 7, HOP.y + HOP.d - 7, 2.4, HOP_H, P, 20), { tone: "lo" }));
  return out.join("");
}

const frameParts = (fx, topZ, y) => S(k.cylinder(fx, y, 2.4, 0, topZ, P, 20), { tone: "mid", crease: "none" }) + S(k.cylinder(fx, y, 3.6, 0, 1.6, P, 20), { tone: "lo" });

function postsAt(frames, topZ, y) {
  return frames.map((fx) => frameParts(fx, topZ, y)).join("");
}

function crossbars(frames, topZ) {
  return frames
    .map((fx) => S(k.slabOf({ x: fx - 3, y: -25, w: 6, d: 50, r: 1 }, topZ, 5, P, 3, 0.4), { tone: "mid" }) + D([at([fx, -21, topZ + 5]), at([fx, 21, topZ + 5])], { size: 0.45 }))
    .join("");
}

function buildGantry() {
  const out = [crossbars(BUILD_FRAMES, BUILD_BEAM_Z - 5)];
  const beam = { x: BUILD_FRAMES[0] - 2, y: -3.5, w: BUILD_FRAMES[1] - BUILD_FRAMES[0] + 4, d: 7, r: 1 };
  out.push(S(k.slabOf(beam, BUILD_BEAM_Z, 4, P, 3, 0.4), { tone: "mid" }));
  HEADS.forEach((hx, i) => {
    const head = { x: hx - 5.5, y: -5.5, w: 11, d: 11, r: 1.2 };
    out.push(`<g data-part="rod-${i}">`);
    out.push(S(k.cylinder(hx, 0, 1.3, PAD_Z + 2, 38 - PAD_Z - 2, P, 16), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(hx, 0, 4, PAD_Z, 2, P, 24, 0.3), { tone: i === ACTIVE_HEAD ? "hi" : "mid", lit: i === ACTIVE_HEAD }));
    out.push(`</g>`);
    out.push(S(k.cylinder(hx, 0, 2.4, 50, BUILD_BEAM_Z - 50, P, 16), { tone: "mid", crease: "none" }));
    out.push(S(k.slabOf(head, 38, 12, P, 3, 0.6), { tone: "mid" }));
    out.push(L(k.ringSeam(k.ringOf(head, 3), 44, P), { tone: "faint" }));
    out.push(`<g data-part="head-lamp-${i}">${D([at([hx + 2.6, head.y + head.d, 47])], { size: 0.7, tone: "lo" })}</g>`);
  });
  return out.join("");
}

function checkGantry() {
  const out = [crossbars(CHECK_FRAMES, CHECK_BEAM_Z - 5)];
  const beam = { x: CHECK_FRAMES[0] - 2, y: -4, w: CHECK_FRAMES[1] - CHECK_FRAMES[0] + 4, d: 8, r: 1 };
  out.push(S(k.slabOf(beam, CHECK_BEAM_Z, 5, P, 3, 0.4), { tone: "mid" }));
  CI_X.forEach((px, i) => {
    out.push(`<g data-part="pin-${i}">`);
    out.push(S(k.cylinder(px, 0, 1, PIN_REST + 1.2, 37 - PIN_REST - 1.2, P, 14), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(px, 0, 2, PIN_REST, 1.2, P, 16), { tone: "hi" }));
    out.push(`</g>`);
    out.push(S(k.cylinder(px, 0, 2, 34, CHECK_BEAM_Z - 34, P, 16), { tone: "mid", crease: "none" }));
    out.push(`<g data-part="ci-lamp-${i}" class="lamp">${D([at([px, 2, CHECK_BEAM_Z + 5])], { size: 1.3, tone: "lo" })}</g>`);
  });
  AGENT_X.forEach((px, i) => {
    out.push(`<g data-part="foot-${i}">`);
    out.push(S(k.cylinder(px, 0, 1.8, FOOT_REST + 2, 33 - FOOT_REST - 2, P, 18), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(px, 0, 3.6, FOOT_REST, 2, P, 24, 0.3), { tone: "hi" }));
    out.push(`</g>`);
    out.push(S(k.cylinder(px, 0, 3.4, 30, CHECK_BEAM_Z - 30, P, 24, 0.4), { tone: "mid" }));
    out.push(L(k.knurl(px, 0, 3.4, 39, 43, 22, P), { tone: "lo" }));
    out.push(`<g data-part="agent-lamp-${i}" class="lamp">${D([at([px, 2, CHECK_BEAM_Z + 5])], { size: 2, tone: "lo" })}</g>`);
  });
  return out.join("");
}

function gate() {
  const out = [];
  for (const y of [-15, 15]) {
    out.push(S(k.cylinder(GATE_X, y, 2, 0, 26, P, 18), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(GATE_X, y, 2.8, 26, 2, P, 18), { tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: GATE_X - 2, y: -17, w: 4, d: 34, r: 0.8 }, 28, 3, P, 2, 0.3), { tone: "mid" }));
  out.push(`<g data-part="gate-lamp" class="lamp">${D([at([GATE_X, 0, 31])], { size: 1.3, tone: "lo" })}</g>`);
  return out.join("");
}

function gateBar() {
  return `<g data-part="gate-bar">${S(k.slabOf({ x: GATE_X - 1.5, y: -13, w: 3, d: 26, r: 0.6 }, 4, 3, P, 2, 0.3), { tone: "hi", crease: "lo" })}</g>`;
}

function lever() {
  const box = { x: POINTS[0] - 5, y: -32, w: 10, d: 10, r: 1.2 };
  return (
    S(k.slabOf(box, 0, 7, P, 3, 0.5), { tone: "mid" }) +
    D([at([box.x + 2, box.y + 2, 7]), at([box.x + box.w - 2, box.y + 2, 7])], { size: 0.4 })
  );
}

function binWalls(bin, which) {
  const { x, y, w, d } = bin;
  const back = [
    { x, y, w, d: WALL, r: 0.5 },
    { x, y, w: WALL, d, r: 0.5 },
  ];
  const front = [
    { x, y: y + d - WALL, w, d: WALL, r: 0.5 },
    { x: x + w - WALL, y, w: WALL, d, r: 0.5 },
  ];
  return (which === "back" ? back : front).map((plan) => S(k.slabOf(plan, 1.5, WALL_H, P, 2, 0.3), { tone: "mid" })).join("");
}

function stack(bin, center, name) {
  const out = [];
  for (let i = 0; i < SLOTS; i++) {
    const plan = { x: center[0] - CARD.w / 2 + ((i * 7) % 3) * 0.4, y: center[1] - CARD.d / 2, w: CARD.w, d: CARD.d, r: 0.6 };
    out.push(`<g data-part="${name}-card-${i}">${S(k.slabOf(plan, 1.5 + i * 1.4, CARD.h, P, 2), { tone: "hi", crease: "lo" })}</g>`);
  }
  return out.join("");
}

function bins() {
  const out = [];
  for (const [bin, center, name, label] of [
    [MAIN_BIN, MAIN_STACK, "main", "main"],
    [INT_BIN, INT_STACK, "int", "integration"],
  ]) {
    out.push(`<path class="iso-halo" d="${k.haloOf(bin, 0, 8, P)}"/>`);
    out.push(S(k.slabOf(bin, 0, 1.5, P, 3, 0.3), { tone: "lo" }));
    out.push(binWalls(bin, "back"));
    out.push(stack(bin, center, name));
    out.push(binWalls(bin, "front"));
    out.push(k.faceTextSvg(k.sideMatrix([bin.x + 4, bin.y + bin.d], 5.6, P, "left"), label, { size: 3.6, tone: "mid" }));
    out.push(D(k.corners(bin, 1).map(([x, y]) => at([x, y, 9.5])), { size: 0.4 }));
  }
  const lock = { x: 206, y: INT_BIN.y + INT_BIN.d, w: 9, d: 3, r: 1 };
  out.push(S(k.slabOf(lock, 1.5, 6.5, P, 2, 0.4), { tone: "mid" }));
  const face = lock.y + lock.d;
  const shackle = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI - (Math.PI * i) / 12;
    shackle.push([lock.x + 4.5 + Math.cos(a) * 3, lock.y + 1.5, 8 + Math.sin(a) * 3.6]);
  }
  out.push(`<path class="iso-line" data-tone="mid" data-free="both" d="${line3(shackle)}" style="stroke-width:1.2"/>`);
  out.push(D([at([lock.x + 4.5, face, 4.6])], { size: 0.7, tone: "lo" }));
  out.push(`<path data-part="key" class="iso-line" data-tone="mid" data-free="end" d="${line3([[lock.x + 4.5, face, 4.6], [lock.x + 9.5, face, 4.6]])}" style="stroke-width:1.1"/>`);
  return out.join("");
}

function carriage() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAR, 3), 2, 0.1, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf(CAR, 2, CAR_TOP - 2, P, 4, 0.6), { tone: "mid" }));
  out.push(D([[-8, -6.5], [8, -6.5], [-8, 6.5], [8, 6.5]].map(([x, y]) => at([x, y, CAR_TOP])), { size: 0.4, tone: "lo" }));
  out.push(L(k.lineOnTop([CAR.x, 8.5], [CAR.x + CAR.w, 8.5], CAR_TOP, P), { tone: "faint" }));
  out.push(`<g data-part="ride-card">${cardSvg()}</g>`);
  return out.join("");
}

function cardSvg() {
  const plan = { x: -CARD.w / 2, y: -CARD.d / 2, w: CARD.w, d: CARD.d, r: 0.6 };
  return (
    S(k.slabOf(plan, CAR_TOP, CARD.h, P, 2), { tone: "hi", crease: "lo", lit: true }) +
    [-3, 0, 3].map((y, i) => L(k.lineOnTop([-5.5, y], [i === 2 ? 1 : 5, y], CARD_TOP, P), { tone: "lo", free: "both" })).join("")
  );
}

const STAGES = [
  {
    key: "plan",
    name: "Plan",
    where: ["ramble-pm"],
    body: "A PM chat (/ramble-pm, on Sonnet) reads STATUS.md from the ramble-pm checkout and the phase in BUILD-PLAN.md, claims a lane in the Lanes table and publishes the claim. It takes the next unit from units.yaml and sets it In Progress on board #19. The card leaves the ledger.",
    cmd: ["bun scripts/plan/site.ts dir", "/ramble-pm  (lane: <name>)"],
  },
  {
    key: "build",
    name: "Build",
    where: ["local"],
    body: "The PM launches /senior on the unit. The senior agent works in its own git worktree cut from origin/main, under a scope manifest (IN SCOPE, OUT OF SCOPE, REFERENCE CODE), and stops before push. The gantry has five heads because at most five builders run at once across every lane.",
    cmd: ["/senior U-035"],
  },
  {
    key: "pr",
    name: "Push and PR",
    where: ["local", "github"],
    body: "agent-git.ts is the agents' only road to GitHub. It mints a token for the Ramble agents App (never Dave's login), pushes only unit/U-…, pm/…, revert/… or sync/… branches, opens the PR against main for a standard unit or integration for a critical one, and requests Dave's review.",
    cmd: ["bun scripts/merge-desk/agent-git.ts push unit/U-035", "bun scripts/merge-desk/agent-git.ts pr main \"U-035: …\" body.md", "bun scripts/merge-desk/agent-git.ts review <pr>"],
  },
  {
    key: "ci",
    name: "CI",
    where: ["github"],
    body: "ci.yml presses nine pins on every PR: format:check, lint, typecheck, test, build and knip, then db (every migration onto an empty Postgres, and a fail if the schema changed without one), e2e (Playwright) and storybook. CodeQL, gitleaks and OSV scans run alongside.",
    cmd: [".github/workflows/ci.yml"],
  },
  {
    key: "agents",
    name: "Agent checks",
    where: ["local", "github"],
    body: "Four bigger plungers are agents on Dave's machine: review, qa (Playwright against the running app, with before-and-after PNGs saved to ramble-pm evidence/pr/), spec-compliance (each acceptance criterion) and architecture-audit. post-check.ts posts each verdict to the PR as a check run, as the App.",
    cmd: ["bun scripts/merge-desk/post-check.ts --name review-agent --sha <head> --conclusion success --summary-file <md>"],
  },
  {
    key: "scope",
    name: "Scope gate",
    where: ["github"],
    body: "The scope-manifest workflow reads only git metadata and units.yaml and never runs code from the PR. The unit's tier must match the base branch, and an agent PR may not touch .github/, .claude/, CLAUDE.md, scripts/merge-desk/, docs/adr/ or docs/plan/. When it passes, the gate lifts and the points are set for the tier.",
    cmd: [".github/workflows/scope-manifest.yml", "scripts/merge-desk/scope-check.ts"],
  },
  {
    key: "merge",
    name: "Merge",
    where: ["github"],
    body: "agent-git.ts automerge queues the merge. The rulesets need every required check green and, while Dave's approval window is open, one approval from him. A standard unit lands on main. A critical unit (holds, payments, the ledger, auth, security headers) lands on integration and waits behind the lock.",
    cmd: ["bun scripts/merge-desk/agent-git.ts automerge <pr>"],
  },
  {
    key: "promote",
    name: "Promote",
    where: ["github", "dave"],
    body: "Nightly smoke (07:00 UTC) runs the smoke, race and access tests on both main and integration. Dave turns the key: he promotes integration to main in one reviewed batch, weekly by default, merging with bypass. No agent can push or promote integration. revert.sh is the one-command undo.",
    skip: "Standard units skip this step: they are already on main.",
    cmd: [".github/workflows/nightly-smoke.yml", "scripts/merge-desk/revert.sh"],
  },
  {
    key: "close",
    name: "Close-out",
    where: ["ramble-pm"],
    body: "The PM checks the unit against its acceptance criteria and manifest, sets Done with actual days, Dave minutes and tokens on board #19, logs a delta-log line if it ran more than 25% over, removes the worktree, and publishes ramble-pm straight to main with site.ts publish (no PR). That push also rebuilds the roadmap page.",
    cmd: ["bun scripts/plan/site.ts publish \"U-035 done\""],
  },
];

const UNITS = { standard: "U-035", critical: "U-048" };

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A sorting bench that stands for Ramble's agent team. A card for one unit leaves a ledger cabinet marked ramble-pm, rides a carriage under a gantry of five builder heads, then under a gantry of nine CI pins and four agent plungers, waits at a scope gate, and is switched by a set of points either to the main tray or to a locked integration tray that only Dave's key empties into main.",
  body: [
    plate(),
    track(),
    hopper(),
    postsAt(BUILD_FRAMES, BUILD_BEAM_Z - 5, -22),
    postsAt(CHECK_FRAMES, CHECK_BEAM_Z - 5, -22),
    lever(),
    `<path data-part="points" class="iso-line" data-tone="lit" data-free="end" d="${k.lineOnTop(POINTS, [POINTS[0] + 9, 0], 3.4, P)}" style="stroke-width:1.2"/>`,
    gate(),
    `<g data-part="carriage" transform="${k.translateAlong(P, [START_X, 0, 0])}">${carriage()}</g>`,
    gateBar(),
    postsAt(BUILD_FRAMES, BUILD_BEAM_Z - 5, 22),
    postsAt(CHECK_FRAMES, CHECK_BEAM_Z - 5, 22),
    buildGantry(),
    checkGantry(),
    bins(),
    `<g data-part="fly-card" style="display:none">${cardSvg()}</g>`,
  ],
});

const EXTRA_CSS = `
.team{margin:18px 0 40px;color:var(--anatomy-text);font-size:14px;line-height:1.55}
.team-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px}
.team-bar button{font:inherit;font-size:13px;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:6px;padding:6px 12px;cursor:pointer;min-height:36px}
.team-bar button:hover{border-color:var(--anatomy-mid)}
.team-bar button[aria-pressed="true"]{border-color:var(--anatomy-strong);color:var(--anatomy-strong);background:color-mix(in srgb,var(--anatomy-strong) 8%,transparent)}
.team-bar .gap{flex:1}
.team-steps{list-style:none;padding:0;margin:0 0 14px;display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
@media (min-width:640px){.team-steps{grid-template-columns:repeat(9,1fr)}}
.team-steps button{width:100%;font:inherit;font-size:12px;text-align:left;color:var(--anatomy-muted);background:transparent;border:0;border-top:2px solid var(--anatomy-faint);padding:6px 0 0;cursor:pointer}
.team-steps button[aria-current="step"]{color:var(--anatomy-strong);border-top-color:var(--anatomy-strong)}
.team-steps button[data-done="true"]{border-top-color:var(--anatomy-mid)}
.team-steps .n{font-family:var(--anatomy-mono);display:block;font-size:10.5px}
.team-detail h2{font-size:17px;margin:0 0 6px;color:var(--anatomy-strong);font-weight:600}
.team-where{display:flex;gap:6px;margin:0 0 8px;flex-wrap:wrap}
.team-where span{font-family:var(--anatomy-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--anatomy-faint);border-radius:999px;padding:2px 8px;color:var(--anatomy-muted)}
.team-where span[data-w="ramble-pm"]{color:var(--anatomy-blue);border-color:color-mix(in srgb,var(--anatomy-blue) 50%,transparent)}
.team-where span[data-w="local"]{color:var(--anatomy-green);border-color:color-mix(in srgb,var(--anatomy-green) 50%,transparent)}
.team-where span[data-w="github"]{color:var(--anatomy-strong)}
.team-where span[data-w="dave"]{color:var(--anatomy-red);border-color:color-mix(in srgb,var(--anatomy-red) 50%,transparent)}
.team-detail p{margin:0 0 10px;max-width:68ch}
.team-detail .skip{color:var(--anatomy-muted);font-style:italic}
.team-detail pre{margin:0;font-family:var(--anatomy-mono);font-size:12px;white-space:pre-wrap;word-break:break-word;color:var(--anatomy-muted);border-left:2px solid var(--anatomy-faint);padding:2px 0 2px 10px}
.team-places{display:grid;grid-template-columns:1fr;gap:14px;margin:28px 0 0}
@media (min-width:640px){.team-places{grid-template-columns:repeat(3,1fr)}}
.team-places h3{font-size:13px;margin:0 0 4px;font-family:var(--anatomy-mono);letter-spacing:.06em;text-transform:uppercase}
.team-places p{margin:0;color:var(--anatomy-muted);font-size:13px}
.team-dave{margin:22px 0 0;font-size:13px;color:var(--anatomy-muted)}
.team-dave strong{color:var(--anatomy-red);font-weight:600}
.lamp[data-on="true"] circle{fill:var(--anatomy-green)!important;stroke:var(--anatomy-green)!important}
.lamp[data-on="fail"] circle{fill:var(--anatomy-red)!important}
`;

const panel = `
<style>${EXTRA_CSS}</style>
<section class="team" aria-label="How the agent team moves one unit">
  <div class="team-bar">
    <button type="button" data-tier="standard" aria-pressed="true">Standard unit (${UNITS.standard})</button>
    <button type="button" data-tier="critical" aria-pressed="false">Critical unit (${UNITS.critical})</button>
    <span class="gap"></span>
    <button type="button" data-act="prev" aria-label="Previous step">◀</button>
    <button type="button" data-act="play" aria-pressed="true">Pause</button>
    <button type="button" data-act="next" aria-label="Next step">▶</button>
  </div>
  <ol class="team-steps">${STAGES.map((s, i) => `<li><button type="button" data-step="${i}"><span class="n">${String(i + 1).padStart(2, "0")}</span>${s.name}</button></li>`).join("")}</ol>
  <div class="team-detail" aria-live="polite"></div>
  <div class="team-places">
    <div><h3 style="color:var(--anatomy-blue)">ramble-pm repo</h3><p>The ledger. STATUS.md (lanes, next, blocked), DECISIONS.md, delta-log.md, audits, evidence PNGs and the roadmap page. The PM pushes it straight to main as the App; it never needs a PR.</p></div>
    <div><h3 style="color:var(--anatomy-green)">Dave's Mac</h3><p>The bench. Several PM chats at once, one lane each, plus the builders in worktrees and the reviewer agents. Shared limits across lanes: five builders, one e2e lock, one Postgres container.</p></div>
    <div><h3 style="color:var(--anatomy-strong)">GitHub: ramble</h3><p>The rails. The Ramble agents App, Actions (CI, scope-manifest, nightly smoke), rulesets on main and integration, auto-merge, and project board #19 where each unit's status and actuals live.</p></div>
  </div>
  <p class="team-dave"><strong>Only Dave:</strong> deploys and production promotion, promoting integration to main, merging with bypass, repo and issue creation (audit tickets excepted), secrets, the App, rulesets, the plan freeze, scope changes, and ADR or design sign-off. Agents print the command instead.</p>
</section>`;

const live = `
const P = ${JSON.stringify(P)};
const STAGES = ${JSON.stringify(STAGES)};
const UNITS = ${JSON.stringify(UNITS)};
const PATHS = { standard: ${JSON.stringify(MAIN_PATH)}, critical: ${JSON.stringify(SPUR_PATH)} };
const START_X = ${START_X}, HEAD_X = ${HEADS[ACTIVE_HEAD]}, STAMP = ${STAMP}, ACTIVE = ${ACTIVE_HEAD};
const CI_X = ${JSON.stringify(CI_X)}, AGENT_X = ${JSON.stringify(AGENT_X)}, CI_DROP = ${PIN_REST - CARD_TOP}, AGENT_DROP = ${FOOT_REST - CARD_TOP};
const GATE_LIFT = ${GATE_LIFT}, POINTS = ${JSON.stringify(POINTS)}, CAR_TOP = ${CAR_TOP}, CARD_H = ${CARD.h}, HOP_H = ${HOP_H};
const HOPPER_TOP = [${HOP.x + 20}, ${HOP.y + 14}, ${HOP_H + 5 * 1.3}];
const MAIN_STACK = ${JSON.stringify(MAIN_STACK)}, INT_STACK = ${JSON.stringify(INT_STACK)}, SLOTS = ${SLOTS};
const LOCK = [${206 + 4.5}, ${INT_BIN.y + INT_BIN.d + 3}, 4.6];
const svg = document.querySelector(".iso-stage svg");
const stage = document.querySelector(".iso-stage");
const $ = (name) => svg.querySelector('[data-part="' + name + '"]');
const carriageEl = $("carriage"), rideCard = $("ride-card"), flyCard = $("fly-card"), gateBar = $("gate-bar"), pointsEl = $("points"), keyEl = $("key");
const rods = ${JSON.stringify(HEADS)}.map((_, i) => $("rod-" + i));
const headLamps = ${JSON.stringify(HEADS)}.map((_, i) => $("head-lamp-" + i));
const pins = CI_X.map((_, i) => $("pin-" + i)), feet = AGENT_X.map((_, i) => $("foot-" + i));
const ciLamps = CI_X.map((_, i) => $("ci-lamp-" + i)), agentLamps = AGENT_X.map((_, i) => $("agent-lamp-" + i)), gateLamp = $("gate-lamp");
const ledgerText = $("ledger-count").querySelector("text"), ledgerLamp = $("ledger-lamp");
const mainCards = Array.from({ length: SLOTS }, (_, i) => $("main-card-" + i)), intCards = Array.from({ length: SLOTS }, (_, i) => $("int-card-" + i));
const readout = document.querySelector("[data-readout]");
const detail = document.querySelector(".team-detail");
const stepButtons = Array.from(document.querySelectorAll("[data-step]"));
const tierButtons = Array.from(document.querySelectorAll("[data-tier]"));
const playButton = document.querySelector('[data-act="play"]');
const still = matchMedia("(prefers-reduced-motion: reduce)");

const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const pathLen = (path) => path.slice(1).reduce((sum, p, i) => sum + segLen(path[i], p), 0);
function pointAt(path, u) {
  for (let i = 1; i < path.length; i++) {
    const len = segLen(path[i - 1], path[i]);
    if (u <= len || i === path.length - 1) {
      const t = Math.max(0, Math.min(1, u / len));
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
    }
    u -= len;
  }
}
const uOfX = (x) => x - START_X;
function targetU(n, tier) {
  const xs = [START_X, HEAD_X, -60, 28, 93, 93];
  if (n < xs.length) return uOfX(xs[n]);
  if (n === 8) return 0;
  return pathLen(PATHS[tier]);
}

let tier = "standard", n = 0, stageTime = 0, playing = !still.matches, visible = false, frame = 0, last = 0;
let u = 0, drop = 0, stampPhase = 0, gateUp = 0, keyTurn = 0, reached = -1e9;
let counts = { main: 3, int: 1 }, open = 91, flight = null, cardOn = "carriage", events = {};
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const follow = (value, target, dt, tau) => (still.matches ? target : value + (target - value) * (1 - Math.exp(-dt / tau)));
const stackTop = (which) => { const c = which === "main" ? MAIN_STACK : INT_STACK; return [c[0], c[1], 1.5 + counts[which] * 1.4]; };
const carTop = () => { const [x, y] = pointAt(PATHS[tier], u); return [x, y, CAR_TOP]; };

function snapshot() {
  events = {};
  flight = null;
  if (n === 0) { counts = { main: 3, int: 1 }; reached = -1e9; cardOn = "hopper"; events.dispense = false; }
  else if (n <= 6) { counts = { main: 3, int: 1 }; cardOn = "carriage"; }
  else if (n === 7) { counts = tier === "standard" ? { main: 4, int: 1 } : { main: 3, int: 2 }; cardOn = "none"; }
  else { counts = { main: 4, int: 1 }; cardOn = "none"; }
  if (n < 3) reached = Math.min(reached, -1e9);
}

function go(next, user) {
  n = (next + STAGES.length) % STAGES.length;
  if (n === 0 && user !== "tier") open = open > 70 ? open : 91;
  stageTime = 0;
  snapshot();
  renderPanel();
  run();
}

function fly(from, to, onLand, duration = 0.9) {
  flight = { from, to, t: 0, duration, onLand };
}

function renderPanel() {
  const s = STAGES[n];
  const skipped = s.key === "promote" && tier === "standard";
  const where = { "ramble-pm": "ramble-pm", local: "Dave's Mac", github: "GitHub", dave: "Dave only" };
  detail.innerHTML = '<h2>' + String(n + 1).padStart(2, "0") + " · " + s.name + "</h2>" +
    '<div class="team-where">' + s.where.map((w) => '<span data-w="' + w + '">' + where[w] + "</span>").join("") + "</div>" +
    (skipped ? '<p class="skip">' + s.skip + "</p>" : "") +
    "<p" + (skipped ? ' style="opacity:.55"' : "") + ">" + s.body.replace(/U-035/g, UNITS[tier]) + "</p>" +
    "<pre>" + s.cmd.map((c) => c.replace(/U-035/g, UNITS[tier]).replace(/pr main/, tier === "critical" ? "pr integration" : "pr main")).join("\\n").replace(/</g, "&lt;") + "</pre>";
  stepButtons.forEach((b, i) => { b.toggleAttribute("aria-current", i === n); if (i === n) b.setAttribute("aria-current", "step"); b.dataset.done = String(i < n); });
  tierButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tier === tier)));
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", String(playing));
}

function setLamp(el, on) { if (el.dataset.on !== String(on)) el.dataset.on = String(on); }
function show(el, on) { const v = on ? "" : "none"; if (el.style.display !== v) el.style.display = v; }

function draw() {
  const [cx, cy] = pointAt(PATHS[tier], u);
  carriageEl.setAttribute("transform", translateAlong(P, [cx, cy, 0]));
  show(rideCard, cardOn === "carriage");
  rods.forEach((rod, i) => rod.setAttribute("transform", translateAlong(P, [0, 0, i === ACTIVE ? -drop : 0])));
  headLamps.forEach((lamp, i) => setLamp(lamp, i === ACTIVE && n === 1));
  const press = (px, r) => { if (cardOn !== "carriage" || cy !== 0) return 0; const d = Math.abs(cx - px); const reach = 8 + r; return d >= reach ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / reach); };
  pins.forEach((pin, i) => pin.setAttribute("transform", translateAlong(P, [0, 0, -CI_DROP * press(CI_X[i], 2)])));
  feet.forEach((foot, i) => foot.setAttribute("transform", translateAlong(P, [0, 0, -AGENT_DROP * press(AGENT_X[i], 3.6)])));
  ciLamps.forEach((lamp, i) => setLamp(lamp, n >= 3 && reached >= CI_X[i]));
  agentLamps.forEach((lamp, i) => setLamp(lamp, n >= 4 && reached >= AGENT_X[i]));
  setLamp(gateLamp, gateUp > 0.5);
  gateBar.setAttribute("transform", translateAlong(P, [0, 0, GATE_LIFT * gateUp]));
  const diverge = tier === "critical" && (n > 5 || (n === 5 && stageTime > 1.4));
  const dir = diverge ? [26, 43] : [1, 0];
  const len = Math.hypot(dir[0], dir[1]);
  pointsEl.setAttribute("d", lineOnTop(POINTS, [POINTS[0] + (dir[0] / len) * 9, POINTS[1] + (dir[1] / len) * 9], 3.4, P));
  const angle = keyTurn * Math.PI / 2;
  keyEl.setAttribute("d", pathOf([iso(LOCK, P), iso([LOCK[0] + Math.cos(angle) * 5, LOCK[1], LOCK[2] + Math.sin(angle) * 5], P)]));
  keyEl.dataset.tone = keyTurn > 0.05 ? "lit" : "mid";
  mainCards.forEach((c, i) => show(c, i < counts.main));
  intCards.forEach((c, i) => show(c, i < counts.int));
  if (flight) {
    const t = ease(Math.min(1, flight.t / flight.duration));
    const to = typeof flight.to === "function" ? flight.to() : flight.to;
    const from = flight.from;
    const p = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t + Math.sin(Math.PI * t) * 22 - CAR_TOP];
    flyCard.setAttribute("transform", translateAlong(P, p));
  }
  show(flyCard, !!flight);
  if (ledgerText.textContent !== open + " open") ledgerText.textContent = open + " open";
  setLamp(ledgerLamp, (n === 0 && stageTime < 1.2) || (n === 8 && events.closed));
  const s = STAGES[n];
  const text = UNITS[tier] + " · " + tier + " · " + (n + 1) + "/9 " + s.name.toLowerCase();
  if (readout.textContent !== text) readout.textContent = text;
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  stageTime += dt;
  const target = targetU(n, tier);
  u = follow(u, target, dt, 0.42);
  if (Math.abs(u - target) < 0.05) u = target;
  const arrived = u === target;
  const [cx] = pointAt(PATHS[tier], u);
  if (n >= 3 && n <= 6) reached = Math.max(reached, cx);

  if (n === 0 && !events.dispense && !flight) {
    events.dispense = true;
    fly(HOPPER_TOP, () => carTop(), () => { cardOn = "carriage"; });
  }
  if (n === 1 && arrived) stampPhase += dt * 3.2; else stampPhase = 0;
  const stampWant = n === 1 && arrived ? STAMP * (0.5 - 0.5 * Math.cos(stampPhase)) : 0;
  drop = still.matches ? stampWant : follow(drop, stampWant, dt, 0.05);
  const gateWant = (n === 5 && stageTime > 0.9) || n === 6 || n === 7 || (n === 8 && cx > 90) ? 1 : 0;
  gateUp = follow(gateUp, gateWant, dt, 0.25);
  if (n === 6 && arrived && !events.binned && !flight) {
    events.binned = true;
    const which = tier === "standard" ? "main" : "int";
    cardOn = "none";
    fly(carTop(), () => stackTop(which), () => { counts[which] += 1; });
  }
  const keyWant = n === 7 && tier === "critical" ? 1 : 0;
  keyTurn = follow(keyTurn, keyWant, dt, 0.3);
  if (n === 7 && tier === "critical" && stageTime > 1.1 && !events.promoted && !flight) {
    events.promoted = true;
    counts.int -= 1;
    const from = stackTop("int");
    fly(from, () => stackTop("main"), () => { counts.main += 1; }, 1.1);
  }
  if (n === 8 && arrived && !events.closed) { events.closed = true; open = Math.max(1, open - 1); }
  if (flight) {
    flight.t += still.matches ? flight.duration : dt;
    if (flight.t >= flight.duration) { const done = flight.onLand; flight = null; done && done(); }
  }
  draw();
  const busy = !arrived || flight || (n === 1 && arrived) || Math.abs(gateUp - gateWant) > 0.002 || Math.abs(keyTurn - keyWant) > 0.002;
  if (playing && stageTime > 2.6 && arrived && !flight && (n !== 1 || stageTime > 3.2)) {
    if (n === 8) { tier = tier === "standard" ? "critical" : "standard"; go(0); }
    else go(n + 1);
  }
  frame = visible && (busy || playing || stageTime < 2) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };

stepButtons.forEach((b) => b.addEventListener("click", () => { playing = false; go(Number(b.dataset.step), "user"); }));
tierButtons.forEach((b) => b.addEventListener("click", () => { tier = b.dataset.tier; u = Math.min(u, targetU(5, tier)); playing = false; go(0, "tier"); }));
document.querySelector('[data-act="prev"]').addEventListener("click", () => { playing = false; go(n - 1, "user"); });
document.querySelector('[data-act="next"]').addEventListener("click", () => { playing = false; go(n + 1, "user"); });
playButton.addEventListener("click", () => { playing = !playing; renderPanel(); run(); });
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") { e.preventDefault(); playing = false; go(n + 1, "user"); }
  if (e.key === "ArrowLeft") { e.preventDefault(); playing = false; go(n - 1, "user"); }
});
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
snapshot();
renderPanel();
draw();
`;

const body =
  k.plateHtml({
    fig: "Fig 1",
    title: "Ramble agent team",
    hint: "Pick a tier, then step or play",
    readout: `${UNITS.standard} · standard · 1/9 plan`,
    keys: [
      { mark: "lit", label: "The unit card: one ticket from units.yaml" },
      { mark: "raised", label: "Nine CI pins, four agent plungers, one scope gate" },
    ],
    caption:
      "A sorting bench for one unit. The card leaves the ramble-pm ledger, is stamped by one of five builder heads in a local worktree, runs under GitHub's checks, and is switched by tier: standard units drop straight into main, critical units wait in integration until Dave turns the key.",
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Agent team sorting bench. Left and right arrow keys step through the nine stages.">${svg}</div>`,
  }) + panel;

const name = theme === "light" ? "agent-team-light.html" : "agent-team.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Ramble agent team", theme, body, script: kitScript() + live, width: 820 }));
console.log("wrote", name);
