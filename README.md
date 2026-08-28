# VALIO — MenuFrame Studio

Restaurant menu design studio (Bulgarian market). Static marketing site plus a
QR digital-menu demo, and the source material the site was built from.

Live deploy target: Vercel project `menuframe-studio` (see "Deploying" below).

## Folder structure

```
VALIO/
├── site/                                # the website (plain static HTML, no build step)
│   ├── index.html                       # landing page — "Меню, което се избира с очите"
│   ├── menu.html                        # menu / services page
│   ├── demo.html                        # "Ателие" — sample QR digital menu demo
│   ├── .vercelignore
│   └── assets/
│       ├── logo.jpg
│       ├── menu-*.jpg|jpeg              # menu style samples (american, bubble,
│       │                                #   desserts, elegant, italian, sushi)
│       ├── promo-*.jpg|jpeg             # promo shots (demo, process, qr, tablet)
│       ├── qr-instagram.png
│       └── dishes/                      # 24 dish photos used in the demo menu
├── menuframe_studio_claude_code_prompts/ # reference screenshots + photos the
│                                         #   design prompts were built from
└── 781459607_...n.jpg                   # loose reference image (Instagram export)
```

## Running locally

No dependencies, no build. Serve `site/` over HTTP (do **not** open via
`file://` — relative asset paths and some browser features break):

```bash
cd site
python3 -m http.server 8000
# then open http://localhost:8000
```

Pages: `/index.html`, `/menu.html`, `/demo.html`

## Deploying

Deployed to Vercel as a static site. `.vercel/` is gitignored, so on a fresh
clone link the project once:

```bash
cd site
npx vercel link          # pick the existing project when prompted
npx vercel deploy --prod --yes --archive=tgz
npx vercel alias ls      # confirm where the domain points
```

For reference, the existing Vercel link is:

| | |
|---|---|
| projectId | `prj_PQZLyp33NxjY29iyA7wUtt1hA62V` |
| orgId | `team_ImraluXoki6ItiqUy78f6ROk` |

## Notes

- Site copy is in Bulgarian.
- Everything under `site/` is hand-written HTML with inline styles; there is no
  package.json, bundler, or framework.
