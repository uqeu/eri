# eri library

Bundled offline reference patterns that eri injects into Mercury's context when
the user's prompt matches a known category. Mercury sees these as "Reference
patterns (already battle-tested, remix freely)" so it doesn't have to invent UI
from scratch.

## How it works

1. eri matches the user's request against directory keywords (file names below).
2. The contents of the matching markdown file are appended to Mercury's user
   message as `# Reference patterns`.
3. Mercury produces a diff that remixes these patterns into the user's request.

## Categories

- `landing.md` — SaaS / product landing pages, hero + features + CTA
- `storefront.md` — e-commerce / shop, product grid + cart
- `dashboard.md` — admin / analytics, sidebar + KPI cards + chart placeholders
- `blog.md` — content site, article cards + reading layout
- `portfolio.md` — personal / agency, work grid + about
- `auth.md` — sign-in / sign-up forms
- `chat.md` — chat UI, conversation list + thread + composer
- `game.md` — 2D canvas game scaffold with input + gameplay loop

Each file is a curated Tailwind-based starter that uses LoremFlickr for
images and assumes `<script src="https://cdn.tailwindcss.com"></script>` plus
Inter via Google Fonts.

These files are NOT meant to be the user's final output. They are *reference*
that Mercury reads and adapts to the user's specific request.
