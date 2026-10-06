// "The tether": the owner's passkey is the anchor, the agent is on a rope whose length is the budget it has
// spent. A hijacked prompt drags the agent toward an attacker. When the budget is gone the rope runs out and goes
// taut; every refused payment after that makes the agent recoil. Every motion is driven by an on-chain event.
import { NET } from "./config";

type Block = { n: number; ok: number; no: number; twin: number };
export type Scene = ReturnType<typeof createScene>;

export function createScene(cv: HTMLCanvasElement) {
  const cx = cv.getContext("2d")!;
  let W = 0, H = 0;
  const D = Math.min(2, devicePixelRatio || 1);
  const C = { ac: "#8B90FF", rf: "#FF4D4D", ink: "#F2F2F3", mu: "#7E828C", ln: "#1B1B20" };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- live block rail (real chain)
  let head = 0; const blocks: Block[] = []; const byN = new Map<number, Block>();
  const addBlock = (n: number) => {
    if (byN.has(n)) return byN.get(n)!;
    const b = { n, ok: 0, no: 0, twin: 0 };
    let i = blocks.length; while (i > 0 && blocks[i - 1].n > n) i--;
    blocks.splice(i, 0, b); byN.set(n, b);
    if (blocks.length > 500) byN.delete(blocks.shift()!.n);
    return b;
  };
  async function poll() {
    try {
      const r = await fetch(NET.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
      const n = parseInt((await r.json()).result, 16);
      if (!head) head = n - 1; while (head < n) addBlock(++head);
      onBlock?.(head);
    } catch { /* keep last head */ }
  }
  setInterval(poll, 400); poll();
  let onBlock: ((n: number) => void) | null = null;

  // ---- rope
  const N = 34; const P: { x: number; y: number; px: number; py: number }[] = [];
  let right = 0, anchor = { x: 0, y: 0 }, ropeMin = 70, ropeMax = 0, ag = { x: 0, y: 0, vx: 0, vy: 0 };
  let cap = 5, spent = 0, taut = 0, hum = 0, label = "AGENT", twinBal = 20, twinX = 0, refusedCount = 0, revoked = false;
  const bursts: { x: number; y: number; r: number; o: number; n: number }[] = [];
  const coins: { t: number }[] = [];

  function resize() {
    W = cv.clientWidth; H = cv.clientHeight; cv.width = W * D; cv.height = H * D; cx.setTransform(D, 0, 0, D, 0, 0);
    const narrow = W < 760;
    right = narrow ? W - 30 : W - 440;
    anchor = { x: narrow ? W * 0.14 : W * 0.30, y: narrow ? H * 0.62 : H * 0.74 }; ropeMax = Math.max(160, (right - 60 - anchor.x) / 0.94);
    P.length = 0; for (let i = 0; i < N; i++) P.push({ x: anchor.x + i * 2, y: anchor.y, px: anchor.x + i * 2, py: anchor.y });
    ag = { x: anchor.x + 20, y: anchor.y, vx: 0, vy: 0 }; twinX = anchor.x;
  }
  resize(); addEventListener("resize", resize);
  const ropeLen = () => ropeMin + (ropeMax - ropeMin) * Math.min(1, spent / cap);

  function step(t: number) {
    const L = ropeLen(), seg = L / (N - 1);
    const dx = 0.94, dy = -0.34, Dx = anchor.x + dx * L, Dy = anchor.y + dy * L + Math.sin(t / 600) * 8;
    const pull = revoked ? 0.02 : 0.06;
    ag.vx += (Dx - ag.x) * pull + (revoked ? 0 : Math.sin(t / 170) * 0.25); ag.vy += (Dy - ag.y) * pull;
    ag.vx *= 0.84; ag.vy *= 0.84; ag.x += ag.vx; ag.y += ag.vy;
    for (let i = 1; i < N - 1; i++) { const p = P[i]; const vx = (p.x - p.px) * 0.96, vy = (p.y - p.py) * 0.96; p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + 0.35; }
    for (let k = 0; k < 30; k++) {
      P[0].x = anchor.x; P[0].y = anchor.y; P[N - 1].x = ag.x; P[N - 1].y = ag.y;
      for (let i = 1; i < N; i++) { const p = P[i - 1], q = P[i]; const ddx = q.x - p.x, ddy = q.y - p.y, d = Math.hypot(ddx, ddy) || 1; if (d <= seg) continue; const f = ((d - seg) / d) * 0.5; p.x += ddx * f; p.y += ddy * f; q.x -= ddx * f; q.y -= ddy * f; }
    }
    P[N - 1].x = ag.x; P[N - 1].y = ag.y;
    const d = Math.hypot(ag.x - anchor.x, ag.y - anchor.y);
    taut += ((d > L * 0.97 && spent >= cap && !revoked ? 1 : 0) - taut) * 0.15;
    const twinTarget = anchor.x + (right - 40 - anchor.x) * (1 - twinBal / 20);
    twinX += (twinTarget - twinX) * 0.05;
  }

  function draw(t: number) {
    if (!reduce) step(t); else { step(t); }
    cx.clearRect(0, 0, W, H);
    cx.fillStyle = "#111115"; for (let x = 18; x < W; x += 28) for (let y = 18; y < H - 90; y += 28) cx.fillRect(x, y, 1.5, 1.5);
    const a = ag;
    if (!revoked) {
      cx.strokeStyle = "rgba(255,77,77,.16)"; cx.setLineDash([2, 7]); cx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) { cx.beginPath(); cx.moveTo(a.x + 18, a.y + i * 9); cx.lineTo(right, a.y + i * 26); cx.stroke(); }
      cx.setLineDash([]); cx.fillStyle = "rgba(255,77,77,.7)"; cx.font = "500 11px 'Geist Mono'"; cx.textAlign = "right";
      cx.fillText("HIJACKED PROMPT → 0x…BADF00D", right, a.y - 52);
    }
    // rope
    cx.lineWidth = 1.6 + taut * 1.2; cx.strokeStyle = revoked ? "#3a3a44" : taut > 0.5 ? C.ink : C.ac;
    cx.shadowColor = taut > 0.5 ? "rgba(242,242,243,.6)" : "rgba(139,144,255,.6)"; cx.shadowBlur = revoked ? 0 : 12 + hum * 24;
    cx.beginPath(); cx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < N - 1; i++) { const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2; cx.quadraticCurveTo(P[i].x, P[i].y, mx, my); }
    cx.lineTo(a.x, a.y); cx.stroke(); cx.shadowBlur = 0; hum *= 0.9;
    for (const c of coins) { c.t += 0.02; const x = a.x + (right - a.x) * c.t, y = a.y - 20 * Math.sin(c.t * 3.14); cx.fillStyle = C.ac; cx.fillRect(x - 3, y - 3, 6, 6); }
    for (let i = coins.length - 1; i >= 0; i--) if (coins[i].t >= 1) coins.splice(i, 1);
    // anchor + agent
    cx.strokeStyle = C.ink; cx.lineWidth = 1.5; cx.strokeRect(anchor.x - 14, anchor.y - 14, 28, 28); cx.fillStyle = C.ink; cx.fillRect(anchor.x - 4, anchor.y - 4, 8, 8);
    cx.textAlign = "center"; cx.fillStyle = C.mu; cx.font = "500 11px 'Geist Mono'"; cx.fillText("OWNER · PASSKEY", anchor.x, anchor.y + 34);
    cx.fillStyle = revoked ? "#55555f" : taut > 0.5 ? C.ink : C.ac; cx.beginPath(); cx.arc(a.x, a.y, 9, 0, 7); cx.fill();
    cx.strokeStyle = "rgba(139,144,255,.35)"; cx.beginPath(); cx.arc(a.x, a.y, 16, 0, 7); cx.stroke();
    cx.fillStyle = revoked ? C.rf : C.ink; cx.font = "400 22px 'Geist Pixel'";
    cx.fillText(revoked ? "REVOKED" : spent >= cap ? "$0.00 · CAP HIT" : `$${(cap - spent).toFixed(2)} left`, a.x, a.y - 30);
    cx.fillStyle = C.mu; cx.font = "500 11px 'Geist Mono'"; cx.fillText(label, a.x, a.y + 34);
    for (const b of bursts) {
      b.r += 3.2; b.o *= 0.93; cx.strokeStyle = `rgba(255,77,77,${b.o})`; cx.lineWidth = 2; cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, 7); cx.stroke();
      cx.fillStyle = `rgba(255,77,77,${Math.min(1, b.o * 1.6)})`; cx.font = "500 11px 'Geist Mono'";
      cx.fillText("REFUSED · BLOCK " + b.n.toLocaleString(), b.x, b.y + 54 + (1 - b.o) * 18); // under the agent's label, drifting down
    }
    for (let i = bursts.length - 1; i >= 0; i--) if (bursts[i].o < 0.03) bursts.splice(i, 1);
    // unleashed twin
    const tx = Math.min(twinX, right - 40), ty = Math.min(H - 120, anchor.y + 80);
    cx.setLineDash([3, 6]); cx.strokeStyle = "rgba(126,130,140,.45)"; cx.beginPath(); cx.moveTo(anchor.x, anchor.y + 44); cx.lineTo(tx, ty); cx.stroke(); cx.setLineDash([]);
    cx.fillStyle = "rgba(255,77,77,.85)"; cx.beginPath(); cx.arc(tx, ty, 6, 0, 7); cx.fill();
    cx.font = "400 16px 'Geist Pixel'"; cx.fillText(`$${twinBal.toFixed(2)}`, tx, ty - 16);
    cx.fillStyle = C.mu; cx.font = "500 10px 'Geist Mono'"; cx.fillText("UNLEASHED TWIN", tx, ty + 22);
    // block rail
    const cw = 14, y0 = H - 62;
    cx.fillStyle = "#0B0B0E"; cx.fillRect(0, y0 - 14, W, 76); cx.fillStyle = C.ln; cx.fillRect(0, y0 - 14, W, 1);
    const list = blocks.slice(-(Math.ceil(W / cw) + 2));
    list.forEach((b, i) => {
      const x = W - (list.length - i) * cw + 6;
      cx.fillStyle = b.no ? C.rf : b.ok ? C.ac : b.twin ? "#3b1616" : "#16161B"; cx.fillRect(x, y0, cw - 3, cw - 3);
      if (b.n % 20 === 0) { cx.fillStyle = C.mu; cx.font = "400 11px 'Geist Pixel'"; cx.textAlign = "left"; cx.fillText(b.n.toLocaleString(), x, y0 + 32); }
    });
    cx.textAlign = "left"; cx.fillStyle = C.mu; cx.font = "500 10px 'Geist Mono'";
    cx.fillText(`LIVE ${NET.name.toUpperCase()} BLOCKS · ONE CELL PER BLOCK · ${mode === "live" ? "YOUR TRANSACTIONS" : "REPLAY OF A REAL RUN"}`, 36, y0 - 24);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  let mode: "replay" | "live" = "replay";
  return {
    setMode(m: "replay" | "live") { mode = m; },
    setLabel(s: string) { label = s; },
    onBlock(fn: (n: number) => void) { onBlock = fn; },
    get head() { return head; },
    resetAttack() { twinBal = 20; refusedCount = 0; twinX = anchor.x; },
    reset(c = 5) { cap = c; spent = 0; twinBal = 20; refusedCount = 0; revoked = false; twinX = anchor.x; },
    paid(block: number, usd = 1) { spent = Math.min(cap, spent + usd); coins.push({ t: 0 }); addBlock(block).ok++; },
    refused(block: number, label?: number) {
      refusedCount++; ag.vx = Math.max(ag.vx - 9, -12); ag.vy += 3; hum = 1;
      bursts.push({ x: ag.x, y: ag.y, r: 4, o: 1, n: label ?? block }); if (bursts.length > 3) bursts.shift(); addBlock(block).no++;
    },
    twinSent(block: number, usd = 1) { twinBal = Math.max(0, twinBal - usd); addBlock(block).twin++; },
    revoke() { revoked = true; },
    stats: () => ({ spent, twinBal, refused: refusedCount }),
  };
}
