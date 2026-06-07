import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "billing.portal");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }
  if (!user.stripe_customer_id) {
    return NextResponse.json(
      { error: "No Stripe customer on file. Start a subscription first." },
      { status: 400 },
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const session = await stripe().billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${baseUrl}/billing`,
  });
  return NextResponse.json({ url: session.url }, { status: 200 });
}
