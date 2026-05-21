# Admin / analytics dashboard reference

For dashboards, admin panels, analytics tools. Sidebar + KPI row + chart area.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{{app_name}} dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<style>html{font-family:Inter,system-ui,sans-serif;}</style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased">

<div class="flex min-h-screen">
  <!-- Sidebar -->
  <aside class="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
    <div class="flex items-center gap-2 px-2 py-3">
      <span class="grid h-8 w-8 place-items-center rounded-xl bg-slate-900 text-white">★</span>
      <span class="font-bold tracking-tight">{{app_name}}</span>
    </div>
    <nav class="mt-4 space-y-1 text-sm">
      <a href="#" class="flex items-center gap-3 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">📊 Overview</a>
      <a href="#" class="flex items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">📦 Orders</a>
      <a href="#" class="flex items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">👥 Customers</a>
      <a href="#" class="flex items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">💳 Billing</a>
      <a href="#" class="flex items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">⚙️ Settings</a>
    </nav>
  </aside>

  <!-- Main -->
  <main class="flex-1">
    <header class="border-b border-slate-200 bg-white px-6 py-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest text-slate-500">Dashboard</p>
          <h1 class="text-xl font-bold tracking-tight">Welcome back</h1>
        </div>
        <div class="flex items-center gap-3">
          <input type="search" placeholder="Search..." class="hidden rounded-full border border-slate-200 bg-white px-4 py-2 text-sm focus:border-slate-400 focus:outline-none md:block">
          <button class="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">New report</button>
        </div>
      </div>
    </header>

    <section class="p-6">
      <!-- KPI row -->
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-widest text-slate-500">Revenue</p>
          <p class="mt-2 text-2xl font-extrabold">$48,201</p>
          <p class="mt-1 text-xs text-emerald-600">+12.4% vs last week</p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-widest text-slate-500">Orders</p>
          <p class="mt-2 text-2xl font-extrabold">1,284</p>
          <p class="mt-1 text-xs text-emerald-600">+3.1%</p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-widest text-slate-500">Customers</p>
          <p class="mt-2 text-2xl font-extrabold">892</p>
          <p class="mt-1 text-xs text-emerald-600">+5.7%</p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-widest text-slate-500">Avg order</p>
          <p class="mt-2 text-2xl font-extrabold">$37.51</p>
          <p class="mt-1 text-xs text-rose-600">−1.2%</p>
        </div>
      </div>

      <!-- Chart placeholder + table -->
      <div class="mt-6 grid gap-6 lg:grid-cols-3">
        <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">Sales over time</h3>
            <select class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs">
              <option>Last 7 days</option>
              <option>Last 30 days</option>
            </select>
          </div>
          <!-- Pure CSS bar chart so we don't need a JS chart lib -->
          <div class="mt-6 flex h-40 items-end gap-2">
            <div class="flex-1 rounded-t-md bg-indigo-600" style="height:42%"></div>
            <div class="flex-1 rounded-t-md bg-indigo-600" style="height:55%"></div>
            <div class="flex-1 rounded-t-md bg-indigo-600" style="height:68%"></div>
            <div class="flex-1 rounded-t-md bg-indigo-600" style="height:48%"></div>
            <div class="flex-1 rounded-t-md bg-indigo-600" style="height:72%"></div>
            <div class="flex-1 rounded-t-md bg-indigo-600" style="height:88%"></div>
            <div class="flex-1 rounded-t-md bg-indigo-600" style="height:64%"></div>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 class="font-semibold">Top customers</h3>
          <ul class="mt-4 space-y-3 text-sm">
            <!-- Repeat 5 rows -->
            <li class="flex items-center justify-between">
              <span class="flex items-center gap-2">
                <img src="https://loremflickr.com/40/40/face?lock=1" class="h-8 w-8 rounded-full object-cover">
                Jane Doe
              </span>
              <span class="font-semibold">$2,184</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </main>
</div>
</body>
</html>
```
