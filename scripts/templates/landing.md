# SaaS landing page reference

Use this layout for landing pages, product pages, marketing sites. Adapt copy
and palette to the user's product; keep the structure.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{product_name}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<style>html{font-family:Inter,system-ui,sans-serif;}</style>
</head>
<body class="bg-white text-slate-900 antialiased">

<!-- Sticky translucent header -->
<header class="sticky top-0 z-30 border-b border-slate-200/60 bg-white/70 backdrop-blur">
  <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
    <a href="#" class="flex items-center gap-2 text-lg font-bold tracking-tight">
      <span class="grid h-8 w-8 place-items-center rounded-xl bg-slate-900 text-white">✦</span>
      {{product_name}}
    </a>
    <nav class="hidden gap-8 md:flex">
      <a class="text-sm font-medium text-slate-600 hover:text-slate-900" href="#features">Features</a>
      <a class="text-sm font-medium text-slate-600 hover:text-slate-900" href="#pricing">Pricing</a>
      <a class="text-sm font-medium text-slate-600 hover:text-slate-900" href="#about">About</a>
    </nav>
    <a href="#cta" class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Get started →</a>
  </div>
</header>

<!-- Hero -->
<section class="relative overflow-hidden">
  <div class="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-50 via-white to-pink-50"></div>
  <div class="mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
    <span class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
      ✦ {{eyebrow}}
    </span>
    <h1 class="mt-6 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
      {{headline}}
    </h1>
    <p class="mt-6 text-lg leading-7 text-slate-600">
      {{subheadline}}
    </p>
    <div class="mt-8 flex flex-wrap justify-center gap-3">
      <a href="#cta" class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700">
        {{primary_cta}}
      </a>
      <a href="#features" class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:border-slate-300">
        {{secondary_cta}}
      </a>
    </div>
  </div>
  <!-- Hero illustration / screenshot -->
  <div class="mx-auto max-w-5xl px-6 pb-20">
    <div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
      <img src="https://loremflickr.com/1200/700/dashboard,saas" alt="Product screenshot" class="w-full">
    </div>
  </div>
</section>

<!-- Features grid -->
<section id="features" class="mx-auto max-w-7xl px-6 py-20">
  <div class="mx-auto max-w-2xl text-center">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">{{features_heading}}</h2>
    <p class="mt-4 text-slate-600">{{features_subhead}}</p>
  </div>
  <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    <!-- Feature card; repeat 6 times with different icons / copy -->
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div class="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-600">⚡</div>
      <h3 class="mt-4 font-semibold">{{feature_title}}</h3>
      <p class="mt-2 text-sm text-slate-600">{{feature_body}}</p>
    </div>
  </div>
</section>

<!-- Social proof -->
<section class="border-y border-slate-200 bg-slate-50 py-12">
  <div class="mx-auto max-w-6xl px-6">
    <p class="text-center text-sm font-semibold uppercase tracking-widest text-slate-500">Trusted by teams at</p>
    <div class="mt-6 grid grid-cols-2 items-center gap-8 opacity-70 sm:grid-cols-4 md:grid-cols-6">
      <!-- Replace with real logos when known; placeholders here -->
      <div class="text-center text-lg font-bold">Acme</div>
      <div class="text-center text-lg font-bold">Globex</div>
      <div class="text-center text-lg font-bold">Initech</div>
      <div class="text-center text-lg font-bold">Soylent</div>
      <div class="text-center text-lg font-bold">Umbrella</div>
      <div class="text-center text-lg font-bold">Stark</div>
    </div>
  </div>
</section>

<!-- Pricing -->
<section id="pricing" class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-center text-3xl font-bold tracking-tight sm:text-4xl">{{pricing_heading}}</h2>
  <div class="mt-12 grid gap-6 md:grid-cols-3">
    <!-- 3 tiers, middle is highlighted -->
    <div class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h3 class="font-semibold">Starter</h3>
      <p class="mt-2 text-4xl font-extrabold">$0</p>
      <ul class="mt-6 space-y-2 text-sm text-slate-600">
        <li>✓ Up to 3 projects</li>
        <li>✓ Community support</li>
      </ul>
      <a class="mt-6 inline-flex w-full justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300" href="#">Choose</a>
    </div>
    <div class="rounded-2xl border-2 border-indigo-600 bg-white p-8 shadow-xl">
      <h3 class="font-semibold text-indigo-600">Pro</h3>
      <p class="mt-2 text-4xl font-extrabold">$29<span class="text-base font-medium text-slate-500">/mo</span></p>
      <ul class="mt-6 space-y-2 text-sm text-slate-600">
        <li>✓ Unlimited projects</li>
        <li>✓ Priority support</li>
      </ul>
      <a class="mt-6 inline-flex w-full justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500" href="#">Choose</a>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h3 class="font-semibold">Enterprise</h3>
      <p class="mt-2 text-4xl font-extrabold">Custom</p>
      <ul class="mt-6 space-y-2 text-sm text-slate-600">
        <li>✓ SSO + audit logs</li>
        <li>✓ Dedicated CSM</li>
      </ul>
      <a class="mt-6 inline-flex w-full justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300" href="#">Talk to sales</a>
    </div>
  </div>
</section>

<!-- CTA -->
<section id="cta" class="mx-auto max-w-5xl px-6 py-20 text-center">
  <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">{{cta_headline}}</h2>
  <p class="mt-4 text-lg text-slate-600">{{cta_subhead}}</p>
  <a href="#" class="mt-8 inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700">{{cta_button}} →</a>
</section>

<footer class="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
  © 2026 {{product_name}}. All rights reserved.
</footer>

</body>
</html>
```

Substitute every `{{placeholder}}` with copy tailored to the user's request.
Keep the section ordering. Adapt accents (indigo by default; use the user's
brand color if mentioned).
