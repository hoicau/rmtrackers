# rmtrackers

A Cloudflare Worker that strips tracking parameters from shared links (Bilibili,
Xiaohongshu, WeChat Official Accounts, NetEase Cloud Music, Zhihu, X/Twitter and
more), with English, Simplified Chinese and Traditional Chinese support.

Forked from [leez233/tracker-remover](https://github.com/leez233/tracker-remover).

Also thanks to Claude Code.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hoicau/rmtrackers)

Clicking the button clones this repository to your own Git account and deploys it
to your Cloudflare account.

## Project structure

```
.
├── src/
│   └── index.js      # Worker entry point (ES module)
├── wrangler.toml     # Cloudflare Workers configuration
├── package.json      # Scripts and dev dependencies
└── README.md
```

## Local development

Requires [Node.js](https://nodejs.org/) and npm.

```sh
npm install
npm test         # run link-resolution regression tests (Node.js 20+)
npm run dev      # start a local dev server via Wrangler
npm run deploy   # deploy to your Cloudflare account
```

Xiaohongshu short links are resolved one redirect at a time, stopping at the
first note or profile URL so a later login redirect cannot replace it. Pasted
login URLs with a valid Xiaohongshu content URL in `redirectPath` are also
supported. The original `xsec_token` and `xsec_source` are preserved; other query
parameters are removed. Login or security pages without a recoverable content
URL produce an error. Cleaned links remain subject to Xiaohongshu's access rules.
