# 2D canvas game scaffold

A polished single-file canvas game with proper input handling, restart, and
score. Adapt mechanic (flappy-style, runner, top-down shooter, snake, etc.) to
the user's request.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{{game_title}}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html,body{margin:0;height:100%;background:#0f172a;font-family:Inter,system-ui,sans-serif;color:#e2e8f0;display:grid;place-items:center;}
  canvas{display:block;background:linear-gradient(180deg,#1e293b,#0f172a);border-radius:18px;box-shadow:0 24px 64px rgba(0,0,0,.4);}
</style>
</head>
<body>
<div class="text-center">
  <h1 class="mb-3 text-2xl font-extrabold tracking-tight">{{game_title}}</h1>
  <p id="hud" class="mb-4 text-sm text-slate-400">Click or press Space to start</p>
  <canvas id="game" width="480" height="640"></canvas>
</div>

<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const hud = document.getElementById('hud');

const cfg = {
  gravity: 0.42,        // Default to forgiving values; tune per game type.
  jumpImpulse: -8,
  pipeSpeed: 2.0,
  pipeGap: 220,
  pipeWidth: 64,
  pipeIntervalFrames: 110,
};

let state;
function reset() {
  state = {
    running: false,
    over: false,
    bird: { x: 90, y: H/2, vy: 0, size: 28 },
    pipes: [],
    frame: 0,
    score: 0,
  };
  hud.textContent = 'Click or press Space to start';
}
reset();

function start() {
  if (state.over) reset();
  state.running = true;
  hud.textContent = 'Score: 0';
}
function flap() {
  if (!state.running) { start(); return; }
  if (state.over) { reset(); return; }
  state.bird.vy = cfg.jumpImpulse;
}

function spawnPipe() {
  const minTop = 60;
  const maxTop = H - cfg.pipeGap - 60;
  const top = Math.random() * (maxTop - minTop) + minTop;
  state.pipes.push({ x: W, top, scored: false });
}

function step() {
  if (!state.running) return;
  state.frame++;
  state.bird.vy += cfg.gravity;
  state.bird.y += state.bird.vy;
  if (state.frame % cfg.pipeIntervalFrames === 0) spawnPipe();
  for (const p of state.pipes) {
    p.x -= cfg.pipeSpeed;
    // Score when bird passes pipe.
    if (!p.scored && p.x + cfg.pipeWidth < state.bird.x) {
      p.scored = true;
      state.score++;
      hud.textContent = 'Score: ' + state.score;
    }
    // Collision.
    const b = state.bird;
    const inX = b.x + b.size > p.x && b.x < p.x + cfg.pipeWidth;
    const inY = b.y < p.top || b.y + b.size > p.top + cfg.pipeGap;
    if (inX && inY) endGame();
  }
  state.pipes = state.pipes.filter(p => p.x + cfg.pipeWidth > -10);
  if (state.bird.y + state.bird.size > H || state.bird.y < 0) endGame();
}

function endGame() {
  state.running = false;
  state.over = true;
  hud.textContent = `Game over · Score ${state.score} · click or press Space to restart`;
}

function draw() {
  ctx.clearRect(0,0,W,H);
  // Pipes
  ctx.fillStyle = '#34d399';
  for (const p of state.pipes) {
    ctx.fillRect(p.x, 0, cfg.pipeWidth, p.top);
    ctx.fillRect(p.x, p.top + cfg.pipeGap, cfg.pipeWidth, H - p.top - cfg.pipeGap);
  }
  // Bird
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(state.bird.x + state.bird.size/2, state.bird.y + state.bird.size/2, state.bird.size/2, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function loop() { step(); draw(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

canvas.addEventListener('click', flap);
document.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); } });
</script>
</body>
</html>
```

**Rules:**
- Default to forgiving difficulty (gap ≥ 200, speed ≤ 2, gravity ≤ 0.45).
- Bind BOTH `click` and `keydown` (Space + ArrowUp) to the action.
- `reset()` MUST restore every mutable variable.
- `endGame()` displays clear restart hint and accepts either input to reset.
- Use `requestAnimationFrame` for the loop.
