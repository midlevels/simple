# aplus CMS

A localhost-only content management system for the aplus-v7 blog. Built with Express + [Pico.css](https://picocss.com) for 11ty, but could be adapted to other local hosted static site generators (there is no authentication for the /dashboard admin area), so do not run it on a production server.  

## Requirements

- **Node.js ≥ 18** (my 11ty blog already requires Node ≥ 22, so maybe go with that, just keep the Node version an even number)
- Works on macOS (including Apple Silicon M2)

## Getting started

```bash
# From the repo root:
npm run cms

# Or manually:
cd cms
npm install
npm start
```

Open **http://localhost:3000** in your browser.

## Features

| Feature | Details |
|---|---|
| **Browse posts** | Paginated list, 50 per page, sorted newest-first |
| **Create post** | Full YAML front-matter form, markdown editor |
| **Edit post** | Pre-filled form; save overwrites `content/posts/{slug}/index.md` |
| **Dark/Light mode** | Toggle theme with button in header; preference saved in localStorage |
| **Delete post** | Removes the entire post directory (with confirmation) |
| **Preview** | Renders markdown + Pico.css in a new browser tab |
| **Cover image** | Uploaded cover is resized to **200 px wide** and saved as **WebP** via Sharp |
| **Portrait image** | When writer or artist is set, a portrait upload appears under the bio field and saves as a **240 px wide WebP** named from the writer/artist |
| **Extra images** | Multiple images can be uploaded; stored in `{slug}/images/` |
| **PDF uploads** | Multiple PDFs can be uploaded; stored in `{slug}/files/` |
| **Copy filename** | Click "Copy" on any uploaded image to copy the filename |
| **Custom YAML** | Add / remove arbitrary front-matter key-value pairs |

## Supported YAML front-matter fields

| Field | Type |
|---|---|
| `title` | text (required) |
| `date` | date picker |
| `writer` | text |
| `artist` | text |
| `bio` | textarea (shown only when writer or artist is set) |
| `excerpt` | textarea |
| `summary` | textarea |
| `tags` | comma-separated list |
| `categories` | comma-separated list |
| `og_image` | text |
| `alpha` | text |
| `draft` | checkbox |
| `sticky` | checkbox |
| `password` | text |
| `cover` | set by cover upload, or type manually |
| _any other key_ | custom fields section |

## Slug generation

New posts get a directory name in the format **`YYYY-MM-title-slug`** derived from the form's date and title fields. This matches the existing `content/posts/` convention I use in my blog.

## Image handling

- **Cover upload** → resized to 200 px wide, converted to WebP, saved to `content/posts/{slug}/images/{name}.webp`. The `cover:` YAML field is updated automatically. These appear on my list pages next to the date, an excerpt, and other information if provided (eg. a book's author). 
- **Portrait upload** → shown when `writer` or `artist` has a value, resized to 240 px wide, converted to WebP, and saved to `content/posts/{slug}/images/{writer-or-artist-name}.webp` using a URL-friendly filename with diacritics removed.
- **Extra uploads** → copied as-is to `content/posts/{slug}/images/`.
- **PDF uploads** → copied as-is to `content/posts/{slug}/files/`.
- Images are served at `/post-images/{slug}/images/{file}` for previews.

## Stopping the server

Press `Ctrl+C` in the terminal.
