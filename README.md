# simple

This repository is a text-only version of `midlevels/startmeup`, preserving the same Eleventy, CMS, CSS, and Nunjucks structure while suppressing rendered media output.

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

Media-bearing content from the source repo is retained in content files where needed for CMS parity, but rendered site output strips images, YouTube embeds, and Apple Music embeds.
