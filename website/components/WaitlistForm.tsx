"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

interface WaitlistFormProps {
  variant?: "hero" | "footer";
}

export function WaitlistForm({ variant = "hero" }: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting") return;

    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus("error");
      setMessage("Enter a valid email.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Something went wrong.");
      }

      setStatus("success");
      setMessage("You're on the list. We'll be in touch.");
      setEmail("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to submit.");
    }
  };

  const isHero = variant === "hero";

  return (
    <form
      onSubmit={handleSubmit}
      className={`w-full ${isHero ? "max-w-md" : "max-w-sm"} animate-fade-up`}
      style={{ animationDelay: "0.4s", opacity: 0 }}
      noValidate
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <label htmlFor={`email-${variant}`} className="sr-only">
          Email address
        </label>
        <input
          id={`email-${variant}`}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@domain.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          disabled={status === "submitting" || status === "success"}
          className="flex-1 px-4 py-3 bg-white/5 border border-white/15 rounded-md text-paper placeholder:text-muted focus:outline-none focus:border-accent focus:bg-white/10 transition disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === "submitting" || status === "success"}
          className="ship-gradient ship-gradient-hover text-ink font-medium px-6 py-3 rounded-md transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {status === "submitting"
            ? "Joining…"
            : status === "success"
              ? "On the list"
              : "Join waitlist"}
        </button>
      </div>
      {message && (
        <p
          className={`mt-3 text-sm ${
            status === "success" ? "text-accent" : "text-red-400"
          }`}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </form>
  );
}
