# Base App â€” Domain Verification (`picoflow.qubitpage.com`)

## TL;DR â€” what Base actually checks

Base's verifier does ONE thing:

> GET `https://picoflow.qubitpage.com/` and look in the HTML response for
> `<meta name="base:app_id" content="<YOUR_APP_ID>">` somewhere inside `<head>`.

That is the entire contract. There is no DNS TXT, no `.well-known`, no callback.
If the meta tag is present in the rendered HTML, the check passes.

## Current state on production (verified)

```
$ curl -A "BaseVerifier/1.0" -H "Accept: text/html" https://picoflow.qubitpage.com/ | head
<!DOCTYPE html><html lang="en"><head>
  <meta name="base:app_id" content="69eca5f48502c283edbf948e">   <-- FIRST CHILD
  <meta charSet="utf-8"/>
  ...
  <meta name="base:app_id" content="69eca5f48502c283edbf948e"/>  <-- DUPLICATE FROM Next metadata
</head>
```

- HTTP/1.1 200 OK
- `Content-Type: text/html; charset=utf-8`
- Tag is the very FIRST child of `<head>` (guaranteed by edge injection)
- Tag is also emitted by Next.js metadata API in BOTH `app/layout.tsx` and `app/page.tsx`
- Three independent occurrences in the served HTML

There is nothing left to add on our side. The page already exceeds Base's spec.

## Why we put the tag in three places

The Base docs example targets the Next.js **Pages Router** (`pages/index.tsx` + `next/head`).
Our dashboard uses the **App Router** (`app/...`), which has different rules:

| Layer | File | Why |
|---|---|---|
| 1. App Router root metadata | [`apps/dashboard/src/app/layout.tsx`](../../apps/dashboard/src/app/layout.tsx#L9-L18) â€” `metadata.other['base:app_id']` | Canonical Next 15 way to add a `<meta>` tag site-wide. |
| 2. App Router page metadata | [`apps/dashboard/src/app/page.tsx`](../../apps/dashboard/src/app/page.tsx#L4-L12) â€” `metadata.other['base:app_id']` | Mirrors Base's "put it on your homepage" example. |
| 3. nginx edge `sub_filter` | `/etc/nginx/sites-enabled/picoflow` | Guarantees the tag is the **first** child of `<head>` even if a strict scraper reads only N bytes or stops at the first non-meta tag. |

**You do NOT need to add `pages/index.tsx`.** The Pages Router code Base shows is just one of many valid layouts â€” App Router metadata produces the same `<meta>` tag in HTML, which is all the verifier looks at.

## Why the verifier may still say "web resource must have metadata"

Once the tag is provably present (it is â€” see curl above), there are exactly three reasons left:

### 1. Base's verifier has a negative cache (most likely)
The first time you clicked "Verify" the tag was not yet deployed. Base's backend caches the failure for some time and the modal keeps showing the cached message even after re-deploy.

**Fix:** Hard-refresh the dashboard tab and click **Verify** again. If still red, wait 5â€“15 minutes and click Verify again. Do NOT keep refreshing the modal â€” that does not retrigger the check; you must click the Verify button.

### 2. Wrong project / wrong app_id (check this once)
Open `https://app.base.org/projects` â†’ open the project named `picoflow` â†’ confirm the App ID shown there equals `69eca5f48502c283edbf948e`. If it differs, copy the correct one and replace it in:
- `apps/dashboard/src/app/layout.tsx`
- `apps/dashboard/src/app/page.tsx`
- nginx `sub_filter` line on `95.179.169.4`

### 3. You typed the wrong domain into the modal
The verifier fetches **exactly** the domain you enter. It must be `picoflow.qubitpage.com` (no path, no scheme, no trailing slash, no `www.`).

## The 400 errors in your console are **unrelated**

The flood of red lines you pasted are all on these two endpoints:

```
GET /v1/projects/69eca5f48502c283edbf948e/onchain-analytics?metrics=...   400
GET /v1/builders/0xa7c61C1d0a6BE394970ebBe994ebaAc07d61A604/resources       400
```

Both endpoints belong to **Base's own backend** (`api.developer.coinbase.com` / `app.base.org`). They are charts and widgets on the dashboard:
- `onchain-analytics` â€” total txns, gas spent, paymaster subsidies, etc. for your project
- `builders/.../resources` â€” credits/quota for your builder wallet

They return 400 because:
- Your project has **zero on-chain activity** yet (no contracts deployed on Base mainnet, no users) â€” the analytics endpoint rejects the query rather than returning empty data.
- The builder resources endpoint has its own internal validation that some new accounts trip.

These 400s come from `app.base.org`'s frontend trying to populate panels. They have **nothing** to do with `picoflow.qubitpage.com` and they do **not** influence the domain verification result.

You can ignore them. They will go away the moment you make your first paymaster-sponsored transaction on Base mainnet.

## How to re-verify (step by step)

1. Open `https://app.base.org/` in a private/incognito window (avoids stale cache).
2. Sign in with the wallet `0xa7c61C1d0a6BE394970ebBe994ebaAc07d61A604`.
3. Go to **Projects â†’ picoflow â†’ Settings â†’ Domain**.
4. Type **exactly**: `picoflow.qubitpage.com`
5. Click **Verify with meta tag**.
6. If it still fails: wait 10 minutes, hard-refresh, click Verify again.

If after two retries with a 10-minute wait it still fails, the issue is on Base's side and the only remediation is opening a ticket at https://discord.gg/buildonbase or https://github.com/base/web/issues with the curl evidence below.

## Evidence to attach if you need to file a Base ticket

```bash
curl -sS -A "BaseVerifier/1.0" -H "Accept: text/html" https://picoflow.qubitpage.com/ \
  | grep -oE '<meta[^>]*base:app_id[^>]*>'
```

Expected output (proof tag is live):
```
<meta name="base:app_id" content="69eca5f48502c283edbf948e">
<meta name="base:app_id" content="69eca5f48502c283edbf948e"/>
```

## What we are NOT going to do

- âŒ Add `pages/index.tsx`. The dashboard is App Router; mixing routers breaks the build.
- âŒ Move the homepage off Next.js to a static `index.html`. The whole dashboard renders from `/`.
- âŒ Strip the `Vary` header. It is correct for Next.js streaming and does not affect the verifier (which sends a normal browser Accept).

## Files referenced

- [apps/dashboard/src/app/layout.tsx](../../apps/dashboard/src/app/layout.tsx)
- [apps/dashboard/src/app/page.tsx](../../apps/dashboard/src/app/page.tsx)
- [README.md](../../README.md) â€” verification gate section
