import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { isValidSlug, readPublished } from "@/app/api/_publish/store";
import { Timeline } from "./Timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

function siteOrigin(): string {
  const explicit = process.env.ERI_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const h = headers();
  const host = h.get("host") ?? "tryeri.ca";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const slug = params.slug?.trim().toLowerCase() ?? "";
  if (!isValidSlug(slug)) {
    return { title: "eri — not found" };
  }
  const project = await readPublished(slug);
  if (!project) {
    return { title: "eri — not found" };
  }
  const title = `${project.name ?? slug} — built with eri`;
  const description = `${project.iterations.length} iteration${
    project.iterations.length === 1 ? "" : "s"
  } of "${project.name ?? slug}" — voice-built with eri. Remix it in seconds.`;
  const url = `${siteOrigin()}/p/${slug}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url,
      images: [{ url: `${siteOrigin()}/og-default.png` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function PublishedProjectPage({ params }: PageProps) {
  const slug = params.slug?.trim().toLowerCase() ?? "";
  if (!isValidSlug(slug)) {
    notFound();
  }
  const project = await readPublished(slug);
  if (!project) {
    notFound();
  }
  const apiUrl = `${siteOrigin()}/api/p/${slug}`;
  return (
    <main className="min-h-screen bg-ink text-paper">
      <Timeline project={project} apiUrl={apiUrl} />
    </main>
  );
}
