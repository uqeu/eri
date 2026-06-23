"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AskExpand } from "./AskExpand";

// The hero: a living iridescent field — domain-warped FBM rendered as oil-slick
// holographic light on deep water, biased toward eri's lime. A real WebGL
// fragment shader (no dependency). Clean bold type + the real eri pill ride on
// top. Reduced-motion paints one still frame; rendering pauses off-screen; if
// WebGL is unavailable the CSS gradient under it still looks good.

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i+vec2(1.,0.)), c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.));
  vec2 u = f*f*(3.-2.*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
// iq cosine palette → smooth iridescence
vec3 pal(float t){
  return vec3(0.5) + vec3(0.5)*cos(6.28318*(vec3(1.0)*t + vec3(0.0,0.33,0.67)));
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv; p.x *= u_res.x / u_res.y;
  float t = u_time * 0.045;

  // flowing domain warp (liquid)
  vec2 q = vec2(fbm(p*1.6 + t), fbm(p*1.6 + vec2(5.2,1.3) - t));
  float f = fbm(p*1.7 + 3.0*q + t*0.3);

  // iridescent hue from the warped field
  float hue = f*1.5 + q.x*0.7 + t*0.25;
  vec3 col = pal(hue);
  // tasteful, not rainbow: pull toward violet/cyan/pink, lime sheen on crests
  col = mix(col, vec3(0.62,0.55,0.95), 0.25);
  col = mix(col, vec3(0.86,1.0,0.32), 0.30*smoothstep(0.55,0.95,f));

  float lum = pow(f, 1.7);
  vec3 base = vec3(0.018,0.022,0.04);
  vec3 color = base + col*lum*1.05;

  // soft light following the cursor
  vec2 m = u_mouse; m.x *= u_res.x/u_res.y;
  float md = distance(p, m);
  color += col * 0.18 * smoothstep(0.5, 0.0, md);

  // vignette + faint grain
  float vig = smoothstep(1.25, 0.32, distance(uv, vec2(0.5)));
  color *= mix(0.55, 1.0, vig);
  color += (hash(gl_FragCoord.xy + u_time) - 0.5) * 0.025;

  gl_FragColor = vec4(color, 1.0);
}`;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function LivingMind(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl =
      (canvas.getContext("webgl", { antialias: false, alpha: false }) as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return; // CSS fallback under the canvas stays visible

    const reduced = reducedMotion();

    const compile = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // fullscreen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");

    const mouse = { x: 0.5, y: 0.55 };
    let W = 0, H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      W = Math.floor(rect.width * dpr);
      H = Math.floor(rect.height * dpr);
      canvas.width = W;
      canvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.uniform2f(uRes, W, H);
    };
    resize();

    const onMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) / rect.width;
      mouse.y = 1 - (e.clientY - rect.top) / rect.height;
    };

    let raf = 0;
    const start = performance.now();
    const frame = (): void => {
      const time = reduced ? 8 : (performance.now() - start) / 1000;
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver((es) => {
      const vis = es[0]?.isIntersecting;
      if (vis && !reduced && !raf) raf = requestAnimationFrame(frame);
      else if (!vis && raf) { cancelAnimationFrame(raf); raf = 0; }
    }, { threshold: 0 });
    io.observe(canvas);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    frame();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <section className="relative isolate overflow-hidden bg-[#05060a]">
      {/* CSS fallback iridescence (shows if WebGL is unavailable; under canvas) */}
      <div aria-hidden className="absolute inset-0 -z-20" style={{
        background:
          "radial-gradient(60% 50% at 30% 30%, rgba(120,90,200,0.35), transparent 60%)," +
          "radial-gradient(50% 50% at 75% 40%, rgba(80,200,220,0.25), transparent 60%)," +
          "radial-gradient(60% 50% at 55% 95%, rgba(224,255,79,0.18), transparent 60%)," +
          "#05060a",
      }} />
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 -z-10 h-full w-full" />
      {/* legibility scrim behind the headline + fade into the light body */}
      <div aria-hidden className="absolute inset-0 -z-10" style={{
        background:
          "radial-gradient(70% 50% at 50% 44%, rgba(5,6,10,0.55) 0%, transparent 70%)," +
          "linear-gradient(180deg, rgba(5,6,10,0.4) 0%, transparent 22%, transparent 70%, #ffffff 100%)",
      }} />

      <div className="mx-auto flex min-h-[100svh] max-w-6xl flex-col items-center justify-center px-6 pb-28 pt-28 text-center">
        <h1 className="font-display text-balance text-[clamp(2.8rem,6.8vw,5.5rem)] font-600 leading-[0.97] tracking-[-0.035em] text-white drop-shadow-[0_2px_50px_rgba(0,0,0,0.8)]">
          the intelligence
          <br className="hidden sm:block" /> that becomes yours
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-pretty text-[clamp(1.05rem,1.7vw,1.3rem)] leading-[1.5] text-white/85 drop-shadow-[0_1px_24px_rgba(0,0,0,0.9)]">
          Not one mind for everyone. eri learns you, runs your world hands-free,
          and grows into your other half.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/download" className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-[15px] font-600 text-[#14180a] shadow-[0_8px_50px_rgba(224,255,79,0.35)] transition-transform duration-200 hover:-translate-y-0.5">
            Download eri
            <ArrowRight size={16} strokeWidth={2.4} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link href="/phone" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-7 py-3.5 text-[15px] text-white backdrop-blur-md transition-colors duration-200 hover:bg-white/10">
            or just text it
          </Link>
        </div>

        <div className="mt-14 flex w-full justify-center">
          <AskExpand />
        </div>
      </div>
    </section>
  );
}
