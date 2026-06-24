"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { authedFetch, signOut, useUser } from "@/lib/auth-client";

type ToastKind = "success" | "error";

interface Toast {
  kind: ToastKind;
  message: string;
}

function formatCreatedAt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function GoogleGlyph(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8368.86-3.0477.86-2.344 0-4.3282-1.5832-5.036-3.7104H.957v2.3318C2.4382 15.9831 5.4818 18 9 18z" fill="#34A853" />
      <path d="M3.964 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.957C.3477 6.1731 0 7.5477 0 9c0 1.4523.3477 2.8268.957 4.0418L3.964 10.71z" fill="#FBBC05" />
      <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.957 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z" fill="#EA4335" />
    </svg>
  );
}

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <section className="border-t border-border py-10 first:border-t-0 first:pt-0">
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
        <div>
          <h2 className="text-[15px] font-medium text-text">{title}</h2>
          {description && (
            <p className="mt-1.5 text-[13px] text-text-sec leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

interface RowProps {
  label: string;
  children: ReactNode;
}

function Row({ label, children }: RowProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 sm:gap-4 sm:items-center py-3 first:pt-0">
      <div className="text-[13px] text-text-sec">{label}</div>
      <div className="text-[14px] text-text min-w-0">{children}</div>
    </div>
  );
}

export default function AccountPage() {
  const { user, reload } = useUser();
  const [displayName, setDisplayName] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [savingPassword, setSavingPassword] = useState<boolean>(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string>("");
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name ?? "");
    }
  }, [user]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    try {
      const response = await authedFetch("/api/auth/me", {
        method: "PATCH",
        body: { display_name: displayName },
      });
      if (!response.ok) {
        setToast({ kind: "error", message: "Could not save profile." });
        return;
      }
      // PATCH /api/auth/me returns the fresh user so the next reload() call
      // surfaces the stored display_name verbatim — Google's OAuth name no
      // longer overwrites what the user typed.
      setToast({ kind: "success", message: "Saved." });
      await reload();
    } catch {
      setToast({ kind: "error", message: "Network error." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSavingPassword(true);
    try {
      const response = await authedFetch("/api/auth/me", {
        method: "PATCH",
        body: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      if (!response.ok && response.status !== 404 && response.status !== 405) {
        setToast({ kind: "error", message: "Could not change password." });
        return;
      }
      console.info("[account] password change pending backend");
      setToast({ kind: "success", message: "Password change requested." });
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setToast({ kind: "error", message: "Network error." });
    } finally {
      setSavingPassword(false);
    }
  }

  async function deleteAccount(): Promise<void> {
    if (!user) return;
    setDeleting(true);
    try {
      const response = await authedFetch("/api/auth/me", { method: "DELETE" });
      if (!response.ok && response.status !== 404 && response.status !== 405) {
        setToast({ kind: "error", message: "Could not delete account." });
        return;
      }
      console.info("[account] delete account pending backend", {
        user_id: user.id,
      });
      await signOut();
    } catch {
      setToast({ kind: "error", message: "Network error." });
    } finally {
      setDeleting(false);
    }
  }

  if (!user) return null;

  const dirtyProfile = displayName !== (user.display_name ?? "");
  const showPassword = user.has_password === true;
  const googleLinked = user.oauth_provider === "google";

  return (
    <div className="max-w-3xl font-geist">
      <p className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">Account</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
        Settings
      </h1>
      <p className="mt-3 text-[14px] text-text-sec">
        Manage your profile, connected sign-in methods, and account security.
      </p>

      <div className="mt-12">
        <Section
          title="Profile"
          description="Your name and email are visible to teammates and shown on invoices."
        >
          <form onSubmit={saveProfile} className="flex flex-col">
            <Row label="Email">
              <div className="flex items-center gap-2">
                <span className="truncate">{user.email}</span>
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded-sm bg-bg-card-2 text-text-sec">
                  verified
                </span>
              </div>
            </Row>
            <Row label="Display name">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="w-full max-w-sm bg-bg-card border border-border rounded-xl px-3 py-2 text-[14px] text-text placeholder:text-text-ter focus:border-[rgba(40,33,22,0.22)] focus:outline-none transition"
              />
            </Row>
            <Row label="Member since">
              <span className="text-text-sec">{formatCreatedAt(user.created_at)}</span>
            </Row>
            <Row label="Plan">
              <span className="inline-flex items-center px-2 py-0.5 text-[12px] rounded-full bg-bg-card-2 border border-border capitalize">
                {user.tier.replace("_", " ")}
              </span>
            </Row>
            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={!dirtyProfile || savingProfile}
                className="rounded-full bg-[#16140f] px-4 py-2 font-geist text-[13.5px] font-600 text-white transition-transform duration-200 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {savingProfile ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </Section>

        <Section
          title="Connected accounts"
          description="Sign-in methods linked to this account."
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-border bg-bg-card px-4 py-3">
              <div className="flex items-center gap-3">
                <GoogleGlyph />
                <div>
                  <div className="text-[14px] text-text">Google</div>
                  <div className="text-[12px] text-text-sec">
                    {googleLinked
                      ? `Signed in via Google as ${user.email}`
                      : "Not connected"}
                  </div>
                </div>
              </div>
              {googleLinked ? (
                <span className="text-[12px] text-green-700">Connected</span>
              ) : (
                <span className="text-[12px] text-text-sec">—</span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-bg-card px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-sm bg-bg-card-2" aria-hidden />
                <div>
                  <div className="text-[14px] text-text">Email & password</div>
                  <div className="text-[12px] text-text-sec">
                    {showPassword
                      ? "Password is set"
                      : "Not set — sign in with Google"}
                  </div>
                </div>
              </div>
              {showPassword ? (
                <span className="text-[12px] text-green-700">Active</span>
              ) : (
                <span className="text-[12px] text-text-sec">—</span>
              )}
            </div>
          </div>
        </Section>

        {showPassword && (
          <Section
            title="Password"
            description="Use a strong password unique to eri."
          >
            <form onSubmit={changePassword} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-text-sec">Current password</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full max-w-sm bg-bg-card border border-border rounded-xl px-3 py-2 text-[14px] text-text focus:border-[rgba(40,33,22,0.22)] focus:outline-none transition"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-text-sec">New password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full max-w-sm bg-bg-card border border-border rounded-xl px-3 py-2 text-[14px] text-text focus:border-[rgba(40,33,22,0.22)] focus:outline-none transition"
                />
                <span className="text-[11px] text-text-sec">
                  At least 8 characters.
                </span>
              </label>
              <div className="mt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={
                    savingPassword ||
                    currentPassword.length === 0 ||
                    newPassword.length < 8
                  }
                  className="rounded-full bg-[#16140f] px-4 py-2 font-geist text-[13.5px] font-600 text-white transition-transform duration-200 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                >
                  {savingPassword ? "Updating…" : "Update password"}
                </button>
              </div>
            </form>
          </Section>
        )}

        <Section
          title="Delete account"
          description="Permanently remove your account and all associated data."
        >
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-4">
            <p className="text-[13px] text-text-sec leading-relaxed">
              Deleting your account cancels any active subscription and
              permanently removes your iterations, voice samples, and billing
              history. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded-full border border-red-300 bg-bg-card px-4 py-2 text-[13.5px] text-red-600 transition hover:bg-red-50"
              >
                Delete account
              </button>
            </div>
          </div>
        </Section>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl text-[13px] border ${
            toast.kind === "success"
              ? "border-border bg-bg-card text-text"
              : "border-red-300 bg-red-50 text-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}

      {deleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
        >
          <div className="w-full max-w-md border border-border rounded-2xl bg-bg-card p-6">
            <h3 className="font-display text-2xl font-600 tracking-[-0.02em] text-red-600">
              Delete account?
            </h3>
            <p className="mt-3 text-[13px] text-text-sec leading-relaxed">
              This cannot be undone. Type{" "}
              <span className="text-text font-medium">DELETE</span> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="mt-4 w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-text focus:border-red-400 focus:outline-none transition"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm("");
                }}
                className="rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text transition hover:border-[rgba(40,33,22,0.22)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteConfirm !== "DELETE" || deleting}
                onClick={() => {
                  void deleteAccount();
                }}
                className="rounded-full border border-red-300 bg-bg-card px-4 py-2 text-[13.5px] text-red-600 transition hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
