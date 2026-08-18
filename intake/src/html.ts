import type { Bindings } from "./types";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function layout(opts: {
  env: Bindings;
  title: string;
  body: string;
  staff?: boolean;
  extraHead?: string;
}): string {
  const nav = opts.staff
    ? `<nav class="topnav"><a href="/admin">Dashboard</a><a href="/admin/alerts">Moderation alerts</a><a href="/admin/waiting">Waiting / received</a><a href="/">Seller site</a></nav>`
    : `<nav class="topnav"><a href="/">Sell my collection</a><a href="/privacy">Privacy &amp; terms</a></nav>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <link rel="stylesheet" href="/styles.css" />
  ${opts.extraHead || ""}
</head>
<body>
  <header class="site-header">
    <div class="brand">Fins &amp; Pins</div>
    ${nav}
  </header>
  <main class="wrap">
    ${opts.body}
  </main>
</body>
</html>`;
}

export function html(env: Bindings, title: string, body: string, staff = false): Response {
  return new Response(layout({ env, title, body, staff }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
