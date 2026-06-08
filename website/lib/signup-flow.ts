export type SignupPlan = "free" | "starter" | "pro" | "pro_plus";
export type PaidSignupPlan = Exclude<SignupPlan, "free">;

const PAID_SIGNUP_PLANS: ReadonlyArray<PaidSignupPlan> = [
  "starter",
  "pro",
  "pro_plus",
];

export function checkoutPlanFromParam(value: string | null): SignupPlan {
  if (!value) return "free";
  if (value === "free") return "free";
  if ((PAID_SIGNUP_PLANS as ReadonlyArray<string>).includes(value)) {
    return value as PaidSignupPlan;
  }
  return "free";
}

export function destinationAfterSignup(plan: SignupPlan): string {
  if (plan === "free") {
    return "/dashboard?welcome=1";
  }
  return `/billing?plan=${encodeURIComponent(plan)}`;
}

export function googleNextPathForPlan(plan: SignupPlan): string {
  return destinationAfterSignup(plan);
}
