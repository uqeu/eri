import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "About — eri",
  description:
    "eri is a voice-first IDE for the people who think faster than they type.",
};

interface Pillar {
  readonly title: string;
  readonly body: string;
}

const PILLARS: ReadonlyArray<Pillar> = [
  {
    title: "Voice is the input layer",
    body: "Typing is a bottleneck most of the day. Talking matches the speed of thinking. eri turns the half-formed sentence in your head into a working diff before you'd have finished the function signature.",
  },
  {
    title: "Diffusion is the model",
    body: "Autoregressive models write code one token at a time. Diffusion models write the whole file at once and then sharpen it. For edits across many lines, this is the difference between waiting and shipping.",
  },
  {
    title: "Your machine is the runtime",
    body: "Voice, gaze, and the editor itself stay local. Only the model calls leave the device, and you choose where they go. We sign the eri Engine calls; everything else can be bring-your-own-keys.",
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
            eri started as a side project: one engineer, a mic, and a hunch that
            staring at a blinking cursor was no longer the fastest way to write
            software. Three drafts later, it turned into something we wanted to
            ship.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Why eri exists
          </h2>
          <p className="mt-6 text-paper/90 leading-relaxed">
            The first wave of AI editors made autocomplete dramatically better.
            The second wave gave us chat sidebars. Both still assume the human
            is the one driving the keyboard. We think that's the wrong frame.
            The keyboard is a 19th-century interface. Voice plus gaze plus a
            model that understands the whole repo is something else entirely —
            a pair programmer who is awake, attentive, and never asks you to
            rephrase.
          </p>
          <p className="mt-5 text-paper/90 leading-relaxed">
            eri is the first IDE built around that idea from the inside out.
            The runtime, the editor, the agent loop, the gaze tracker, and the
            voice pipeline are all our own code. There is no fork. There is no
            extension wrapping someone else's editor.
          </p>
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
            anyway. If that sounds like a place you'd want to work, the careers
            page is one click away.
          </p>
          <p className="mt-5 text-muted leading-relaxed">
            Headquartered in San Francisco. Distributed across four time zones.
            Hiring in two more.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
