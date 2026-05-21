import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WaitlistEntry {
  email: string;
  timestamp: string;
}

interface WaitlistFile {
  entries: WaitlistEntry[];
}

const STORE_PATH = path.join(process.cwd(), ".waitlist.json");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readStore(): Promise<WaitlistFile> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<WaitlistFile>;
    if (Array.isArray(parsed.entries)) {
      return { entries: parsed.entries };
    }
    return { entries: [] };
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { entries: [] };
    }
    throw error;
  }
}

async function writeStore(store: WaitlistFile): Promise<void> {
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { email?: unknown }).email !== "string"
  ) {
    return NextResponse.json(
      { error: "Email is required." },
      { status: 400 },
    );
  }

  const email = (payload as { email: string }).email.trim().toLowerCase();

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json(
      { error: "Enter a valid email." },
      { status: 400 },
    );
  }

  try {
    const store = await readStore();
    const alreadyJoined = store.entries.some((entry) => entry.email === email);
    if (!alreadyJoined) {
      const next: WaitlistFile = {
        entries: [
          ...store.entries,
          { email, timestamp: new Date().toISOString() },
        ],
      };
      await writeStore(next);
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("waitlist write failed", error);
    return NextResponse.json(
      { error: "Could not save your email. Try again shortly." },
      { status: 500 },
    );
  }
}
