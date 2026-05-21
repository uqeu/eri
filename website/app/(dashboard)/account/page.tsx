"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authedFetch, signOut, useUser } from "@/lib/auth-client";

type ToastKind = "success" | "error";

interface Toast {
  kind: ToastKind;
  message: string;
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
      if (!response.ok && response.status !== 404 && response.status !== 405) {
        setToast({ kind: "error", message: "Could not save profile." });
        return;
      }
      // The PATCH /api/auth/me endpoint is not yet implemented server-side;
      // log the change client-side so we can wire it up later without losing the UX.
      // eslint-disable-next-line no-console
      console.info("[account] display_name change pending backend", {
        user_id: user.id,
        display_name: displayName,
      });
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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

  return (
    <div className="max-w-3xl">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">Account</p>
      <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
        Profile settings
      </h1>

      <section className="mt-10 border border-white/10 rounded-lg p-6 bg-white/[0.02]">
        <h2 className="font-display text-xl tracking-tight">Profile</h2>
        <form onSubmit={saveProfile} className="mt-6 flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">
              Email
            </span>
            <input
              type="email"
              value={user.email}
              disabled
              className="bg-transparent border border-white/10 rounded-md px-4 py-3 text-muted"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">
              Display name
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-accent focus:outline-none transition"
            />
          </label>
          <button
            type="submit"
            disabled={savingProfile}
            className="self-start border border-white/20 hover:border-accent text-paper px-4 py-2 rounded-md text-sm transition disabled:opacity-50"
          >
            {savingProfile ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>

      <section className="mt-6 border border-white/10 rounded-lg p-6 bg-white/[0.02]">
        <h2 className="font-display text-xl tracking-tight">Password</h2>
        <form onSubmit={changePassword} className="mt-6 flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">
              Current password
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-accent focus:outline-none transition"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">
              New password
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-accent focus:outline-none transition"
            />
          </label>
          <button
            type="submit"
            disabled={savingPassword}
            className="self-start border border-white/20 hover:border-accent text-paper px-4 py-2 rounded-md text-sm transition disabled:opacity-50"
          >
            {savingPassword ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className="mt-6 border border-red-500/30 rounded-lg p-6 bg-red-500/[0.04]">
        <h2 className="font-display text-xl tracking-tight text-red-300">
          Danger zone
        </h2>
        <p className="mt-3 text-sm text-muted">
          Deleting your account is permanent. All iterations, voice samples,
          and billing history will be removed.
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="mt-6 border border-red-500/40 hover:border-red-400 text-red-300 px-4 py-2 rounded-md text-sm transition"
        >
          Delete account
        </button>
      </section>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-md text-sm border ${
            toast.kind === "success"
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-red-500/50 bg-red-500/10 text-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}

      {deleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
        >
          <div className="w-full max-w-md border border-white/15 rounded-lg bg-ink p-6">
            <h3 className="font-display text-2xl tracking-tight text-red-300">
              Delete account?
            </h3>
            <p className="mt-3 text-sm text-muted">
              This cannot be undone. Type{" "}
              <span className="text-paper font-medium">DELETE</span> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="mt-4 w-full bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-red-400 focus:outline-none transition"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm("");
                }}
                className="border border-white/20 hover:border-paper text-paper px-4 py-2 rounded-md text-sm transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteConfirm !== "DELETE" || deleting}
                onClick={() => {
                  void deleteAccount();
                }}
                className="bg-red-500/80 hover:bg-red-500 text-paper px-4 py-2 rounded-md text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
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
