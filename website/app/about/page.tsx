import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "About — eri",
  description:
    "eri is a voice-first, local-first IDE for the people who think faster than they type.",
};

interface Pillar {
  readonly title: string;
  readonly body: string;
}

const PILLARS: ReadonlyArray<Pillar> = [
  {
    title: "Voice is the input layer",
    body: "Typing is a bottleneck most of the day. Talking matches the speed of thinking. eri turns the half-formed sentence in your head into a working diff before you'd have finished the function signature. The transcription runs on your laptop, not ours.",
  },
  {
    title: "Diffusion is the model",
    body: "Autoregressive models write code one token at a time. Eri's engine denoises the whole patch at once. For multi-line refactors, this is the difference between waiting and shipping.",
  },
  {
    title: "Your machine is the runtime",
    body: "Voice transcription, gaze tracking, text-to-speech, and the editor itself stay local. Only the model inference call leaves the device, and you choose where it goes and which key signs it.",
  },
];

interface ManifestoLine {
  readonly tag: string;
  readonly text: string;
}

const MANIFESTO: ReadonlyArray<ManifestoLine> = [
  {
    tag: "01",
    text: "We don't want your code on our servers. Your repository lives on your laptop. The only thing we see is the prompt you ask us to forward, and only when you choose to route through us.",
  },
  {
    tag: "02",
    text: "We don't want to sell your usage data. We don't have an ad model. We don't sell prompts, completions, or telemetry. If we ever change this, we'll tell you in plain English first, not in a Terms update.",
  },
  {
    tag: "03",
    text: "We don't want to obscure which model handled your request. The iterator panel logs the model, token count, and latency for every voice turn. If we auto-route, we show the decision. No \"Auto\" hand-wave.",
  },
  {
    tag: "04",
    text: "We don't want to surprise-bill you. Every paid tier is hard-capped at its monthly headline price. When you hit the cap, eri stops cloud turns and lets you continue with your own key. There is no overage line item.",
  },
];

export default function AboutPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            About
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            We're building the IDE that listens.
          </h1>
          <p className="mt-6 text-lg text-muted leading-relaxed">
            eri started as a side project: one engineer, a mic, and a hunch
            that staring at a blinking cursor was no longer the fastest way to
            write software. Three drafts later, it turned into something we
            wanted to ship.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Why eri exists
          </h2>
          <p className="mt-6 text-paper/90 leading-relaxed">
            The first wave of AI editors made autocomplete dramatically
            better. The second wave gave us chat sidebars. Both still assume
            the human is the one driving the keyboard. We think that's the
            wrong frame. The keyboard is a 19th-century interface. Voice plus
            gaze plus a model that understands the whole repo is something
            else — a pair programmer who is awake, attentive, and never asks
            you to rephrase.
          </p>
          <p className="mt-5 text-paper/90 leading-relaxed">
            eri is a VSCodium fork with a local Rust sidecar. The editor, the
            voice pipeline, the gaze tracker, and the iteration history are
            our own code. We kept the VSCode extension surface so your
            keymaps and plugins still work — we replaced the loop, not the
            ergonomics.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Manifesto
          </p>
          <h2 className="mt-5 font-display text-3xl sm:text-4xl tracking-tight">
            Four things we won't do.
          </h2>
          <p className="mt-5 text-paper/85 leading-relaxed">
            We started eri because the tools we used every day kept making
            choices we wouldn't have made for ourselves. So we wrote them
            down. These are the four lines we don't blur.
          </p>
          <div className="mt-10 flex flex-col gap-7">
            {MANIFESTO.map((line) => (
              <div key={line.tag} className="flex gap-5">
                <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/[0.08] font-mono text-[11px] text-accent">
                  {line.tag}
                </span>
                <p className="text-paper/85 leading-relaxed">{line.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            What we believe
          </h2>
          <div className="mt-10 flex flex-col gap-10">
            {PILLARS.map((pillar) => (
              <div key={pillar.title}>
                <h3 className="font-display text-xl tracking-tight text-paper">
                  {pillar.title}
                </h3>
                <p className="mt-3 text-muted leading-relaxed">{pillar.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Who we are
          </h2>
          <p className="mt-6 text-paper/90 leading-relaxed">
            A small team building in public. We post the weeks that went well
            and the weeks that didn't. We answer email. We ship on Fridays
            anyway. If that sounds like a place you'd want to work, the
            careers page is one click away.
          </p>
          <p className="mt-5 text-muted leading-relaxed">
            Headquartered in San Francisco. Distributed across four time
            zones. Hiring in two more.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
