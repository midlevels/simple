> Imported into `midlevels/simple` as `startmeup/`. Run the npm commands below from this directory.

## Hello, there!

This is a personal site built with [Eleventy (11ty)](https://www.11ty.dev/).

---

## Common npm scripts

| Command | What it does |
|---------|-------------|
| `npm start` | Local dev server with live reload |
| `npm run build` | Build the site to `_site/` |
| `npm run build:all` | Build + generate Pagefind search index |
| `npm run og:image` | Generate missing `og-image.webp` for posts |
| `npm run og:image:force` | Regenerate **all** `og-image.webp` files |
| `npm run cms` | Start the local CMS (runs on <http://localhost:3000>) |
| `npm run setup-cms` | Install CMS dependencies (run once after cloning) |

---

## Quick shortcode reference

for decorative linebreak
{% hr %}

for youtube embeds
{% youtube "https://vid_url" %}

for sized/centered images (caption is optional)
{% sizing "images/name.webp", "60%", "optional caption" %}

for callouts
{% callout "Text of brief text callout" %}
