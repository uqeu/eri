import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Blog — eri",
  description: "Notes from the team building eri.",
};

interface Post {
  readonly slug: string;
  readonly title: string;
  readonly dek: string;
  readonly date: string;
  readonly readTime: string;
  readonly author: string;
}

const POSTS: ReadonlyArray<Post> = [
  {
    slug: "why-we-built-eri",
    title: "Why we built eri",
    dek: "The story of how a frustrated demo on a kitchen table turned into a voice-first IDE — and why the second wave of AI editors is going to look nothing like the first.",
    date: "May 14, 2026",
    readTime: "7 min read",
    author: "the eri team",
  },
  {
    slug: "on-lazy-voice-and-gaze",
    title: "On lazy voice + gaze",
    dek: "Always-on microphones are creepy. Always-on cameras are worse. Here's the input model we landed on instead, and why it feels more like a colleague than a recording device.",
    date: "April 28, 2026",
    readTime: "5 min read",
    author: "the eri team",
  },
  {
    slug: "the-diffusion-advantage",
    title: "The diffusion advantage",
    dek: "Why we bet the runtime on a diffusion code model instead of another autoregressive one, what changed in our internal benchmarks, and where it still falls short.",
    date: "April 9, 2026",
    readTime: "9 min read",
    author: "the eri team",
  },
];

export default function BlogIndexPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Blog
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Notes from the workbench.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Long-form posts about the shape of voice-first development, what
            we're learning as we build, and the occasional rant about
            autocomplete.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <ul className="flex flex-col divide-y divide-white/10 border-y border-white/10">
            {POSTS.map((post) => (
              <li key={post.slug} className="py-10">
                <Link href={`/blog/${post.slug}`} className="group block">
                  <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-paper/40">
                    <span>{post.date}</span>
                    <span aria-hidden>·</span>
                    <span>{post.readTime}</span>
                  </div>
                  <h2 className="mt-3 font-display text-2xl sm:text-3xl tracking-tight text-paper transition group-hover:text-accent">
                    {post.title}
                  </h2>
                  <p className="mt-3 max-w-2xl text-muted leading-relaxed">
                    {post.dek}
                  </p>
                  <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-paper/40">
                    {post.author} → read post
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
