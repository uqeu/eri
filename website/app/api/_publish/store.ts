import { promises as fs } from "node:fs";
import path from "node:path";

export interface PublishIntent {
  text: string;
  ts?: string;
}

export interface PublishIteration {
  n: number;
  prompt: string;
  html: string;
  ts: string;
}

export interface PublishedProject {
  slug: string;
  name?: string;
  intents: PublishIntent[];
  iterations: PublishIteration[];
  publishedAt: string;
}

const STORE_DIR = path.join(process.cwd(), ".published");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

export async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export function pathForSlug(slug: string): string {
  return path.join(STORE_DIR, `${slug}.json`);
}

export async function readPublished(
  slug: string,
): Promise<PublishedProject | null> {
  if (!isValidSlug(slug)) {
    return null;
  }
  try {
    const raw = await fs.readFile(pathForSlug(slug), "utf8");
    const parsed = JSON.parse(raw) as PublishedProject;
    if (parsed && Array.isArray(parsed.iterations)) {
      return parsed;
    }
    return null;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function writePublished(project: PublishedProject): Promise<void> {
  await ensureStoreDir();
  const target = pathForSlug(project.slug);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), "utf8");
  await fs.rename(tmp, target);
}
