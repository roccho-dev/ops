# ADRS UI deployment slice

This directory temporarily owns the complete static application deployed to Cloudflare Pages.

```text
apps/adrs-ui/
├── index.html
└── README.md
```

Current rules:

- no cross-repository input;
- no build dependency;
- no secret value in this directory;
- `.github/workflows/deploy-adrs-ui-cloudflare-pages.yml` is the only effectful entrypoint;
- split source, data, build, or provider adapters only after a second concrete consumer proves the need.

GitHub Environment `cloudflare-production` must provide:

| Kind | Name |
|---|---|
| variable | `CLOUDFLARE_ACCOUNT_ID` |
| variable | `CLOUDFLARE_PAGES_PROJECT` |
| secret | `CLOUDFLARE_API_TOKEN` |

The Cloudflare Pages project production branch must be `proposals` for this first slice.
