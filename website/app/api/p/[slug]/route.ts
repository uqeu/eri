import { NextResponse } from "next/server";
import { isValidSlug, readPublished } from "../../_publish/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim().toLowerCase() ?? "";
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "Invalid slug." }, { status: 400 });
  }
  try {
    const project = await readPublished(slug);
    if (!project) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json(project, { status: 200 });
  } catch (error) {
    console.error("publish read failed", error);
    return NextResponse.json(
      { error: "Could not read project." },
      { status: 500 },
    );
  }
}
