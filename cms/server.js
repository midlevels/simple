/**
 * aplus CMS – localhost post manager
 * Run: cd cms && npm install && npm start
 * Opens at: http://localhost:3000
 */

import express from 'express';
import matter from 'gray-matter';
import sharp from 'sharp';
import multer from 'multer';
import MarkdownIt from 'markdown-it';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import trash from 'trash';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT          = process.env.PORT || 3000;
const POSTS_DIR     = path.resolve(__dirname, '../content/posts');
const COVERS_DIR    = path.resolve(__dirname, '../img/covers');
const TMP_DIR       = path.join(__dirname, '.tmp');
const PER_PAGE      = 50;
const MAX_SLUG_LENGTH = 60;
const EARLIEST_YEAR = 2009;
const HK_UTC_OFFSET = '+08:00';
const HK_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Multer (file upload) ──────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename:    (_req, file, cb) => {
    const safe   = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${safe}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const isImageField = ['cover_upload', 'portrait_upload', 'extra_images'].includes(file.fieldname)
      || file.fieldname.startsWith('portrait_upload_');
    const isPdfField = file.fieldname === 'extra_pdfs';
    const isImage = /\.(jpe?g|png|gif|webp|avif|svg|tiff?)$/i.test(file.originalname);
    const isPdf = /\.pdf$/i.test(file.originalname);
    cb(null, (isImageField && isImage) || (isPdfField && isPdf));
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

const uploadFields = upload.any();

// ─── Markdown renderer ────────────────────────────────────────────────────────

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: true }));

// Serve post images at /post-images/<slug>/images/<file>
app.use('/post-images', express.static(POSTS_DIR));

// Serve cover images at /img/covers/<file>
app.use('/img', express.static(path.resolve(__dirname, '../img')));

// ─── Field definitions ────────────────────────────────────────────────────────

const FIELDS = [
  { key: 'title',    label: 'Title',             type: 'text',     required: true },
  { key: 'date',     label: 'Date',              type: 'date'                     },
  { key: 'writer',   label: 'Writer',            type: 'text'                     },
  { key: 'artist',   label: 'Artist',            type: 'text'                     },
  { key: 'bio',      label: 'Bio',               type: 'textarea', rows: 4, conditional: 'writer_or_artist' },
  { key: 'excerpt',  label: 'Excerpt',           type: 'textarea', rows: 2        },
  { key: 'tags',     label: 'Tags',              type: 'tags'                     },
  { key: 'draft',    label: 'Draft',             type: 'checkbox'                 },
];

const SHARE_FIELDS = [
  { key: 'title',    label: 'Title',             type: 'text',     required: true },
  { key: 'date',     label: 'Date',              type: 'date'                     },
  { key: 'source',   label: 'Source',            type: 'text',     fullWidth: true },
  { key: 'linkurl',  label: 'Link URL',          type: 'text',     fullWidth: true },
  { key: 'draft',    label: 'Draft',             type: 'checkbox'                 },
];

const QUOTATION_FIELDS = [
  { key: 'title',       label: 'Title',          type: 'text',     required: true },
  { key: 'date',        label: 'Date',           type: 'date'                     },
  { key: 'quotation',   label: 'Quotation',      type: 'textarea'                 },
  { key: 'attribution', label: 'Attribution',    type: 'text',     fullWidth: true },
  { key: 'draft',       label: 'Draft',          type: 'checkbox'                 },
];

const REMOVED_KEYS = ['linky', 'via'];
const KNOWN_KEYS = [...FIELDS.map(f => f.key), 'cover', ...REMOVED_KEYS];
const SHARE_KNOWN_KEYS = [...SHARE_FIELDS.map(f => f.key), 'tags', 'post-slug'];
const QUOTATION_KNOWN_KEYS = [...QUOTATION_FIELDS.map(f => f.key), 'tags', 'post-slug'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** HTML-escape a value for safe embedding in HTML attributes / text nodes. */
const esc = (s) =>
  s == null
    ? ''
    : String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/** Escape markdown special characters in alt text and filenames. */
const escMd = (s) =>
  s === null || s === undefined
    ? ''
    : String(s)
        .replace(/\\/g, '\\\\')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

/** Reject slugs that could attempt path traversal. */
const validSlug = (s) =>
  typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9\-]*$/.test(s);

/** Return all posts sorted newest-first. */
function getAllPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(POSTS_DIR, entry.name, 'index.md')),
    )
    .map((entry) => {
      try {
        const { data } = matter(
          fs.readFileSync(path.join(POSTS_DIR, entry.name, 'index.md'), 'utf8'),
        );
        return {
          slug:   entry.name,
          title:  data.title  || entry.name,
          date:   data.date   || null,
          writer: data.writer || data.artist || '',
          cover:  data.cover  || '',
          draft:  !!data.draft,
          tags:   Array.isArray(data.tags) ? data.tags : [],
        };
      } catch {
        return { slug: entry.name, title: entry.name, date: null, writer: '', cover: '', draft: false, tags: [] };
      }
    })
    .sort(
      (a, b) =>
        new Date(b.date || 0) - new Date(a.date || 0) ||
        a.slug.localeCompare(b.slug),
    );
}

/** Read a single post; returns null if not found. */
function readPost(slug) {
  const fp = path.join(POSTS_DIR, slug, 'index.md');
  if (!fs.existsSync(fp)) return null;
  const { data, content } = matter(fs.readFileSync(fp, 'utf8'));
  return { data, content };
}

/** Write (create or overwrite) a post. */
function writePost(slug, data, content) {
  const dir = path.join(POSTS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.md'),
    matter.stringify(content.replace(/^\n+/, ''), data),
    'utf8',
  );
}

/** Recursively delete a post directory. */
function deletePost(slug) {
  fs.rmSync(path.join(POSTS_DIR, slug), { recursive: true, force: true });
}

/** Convert a string to a URL-safe slug. */
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, MAX_SLUG_LENGTH);

/**
 * Slugify a person's name (writer or artist) for use in portrait filenames.
 * 
 * This function normalizes Unicode characters with diacritics to ensure consistent
 * filename generation regardless of how the name is entered.
 * 
 * NOTE: The normalization logic is duplicated in the client-side JS (slugifyPortraitName)
 * and in scripts/fetch-writer-photos.js (generateFilename). This is intentional to keep
 * these systems independent while ensuring they produce identical results.
 * 
 * Normalization steps:
 * 1. Normalize to NFKD (decompose characters with diacritics)
 * 2. Remove diacritic marks (U+0300 to U+036F)
 * 3. Convert to lowercase
 * 4. Replace non-alphanumeric sequences with dashes
 * 5. Remove leading/trailing dashes
 * 6. Truncate to MAX_SLUG_LENGTH
 * 
 * Examples:
 * - "José García" → "jose-garcia"
 * - "François Müller" → "francois-muller"
 */
function slugifyPersonName(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, MAX_SLUG_LENGTH);
}

function getPortraitSourceName(writer, artist) {
  return (typeof writer === 'string' && writer.trim())
    || (typeof artist === 'string' && artist.trim())
    || '';
}

function getPortraitFilename(writer, artist) {
  const stem = slugifyPersonName(getPortraitSourceName(writer, artist));
  return stem ? `${stem}.webp` : '';
}

/**
 * Generate a legacy portrait filename (without diacritic normalization).
 * 
 * Used for backwards compatibility with files created before diacritic handling was fixed.
 * Legacy naming treated diacritics as non-alphanumeric characters, resulting in filenames
 * like "jos-garc-a.webp" instead of "jose-garcia.webp".
 * 
 * NOTE: The duplication between this and slugifyPersonName is intentional - this preserves
 * the old buggy behavior for backwards compatibility, while slugifyPersonName has the fix.
 */
function getLegacyPortraitFilename(writer, artist) {
  const source = getPortraitSourceName(writer, artist);
  if (!source) return '';
  const stem = String(source)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, MAX_SLUG_LENGTH);
  return stem ? `${stem}.webp` : '';
}

/**
 * Find the actual portrait filename that exists in the post's images directory.
 * Tries the normalized filename first, then falls back to legacy naming.
 */
function findPortraitFile(slug, writer, artist) {
  if (!validSlug(slug)) return null;
  
  const images = getPostImages(slug);
  
  // Try normalized filename first (current standard)
  const normalizedFilename = getPortraitFilename(writer, artist);
  if (normalizedFilename && images.includes(normalizedFilename)) {
    return normalizedFilename;
  }
  
  // Fall back to legacy filename (for backwards compatibility)
  const legacyFilename = getLegacyPortraitFilename(writer, artist);
  if (legacyFilename && legacyFilename !== normalizedFilename && images.includes(legacyFilename)) {
    return legacyFilename;
  }
  
  return null;
}

function portraitExists(slug, writer, artist) {
  return findPortraitFile(slug, writer, artist) !== null;
}

/** Generate a YYYY-MM-title-slug directory name. */
function makeSlug(title, date) {
  const raw = typeof date === 'string' ? date.trim() : '';
  const match = raw.match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (match) {
    return `${match[1]}-${match[2]}-${slugify(title)}`;
  }
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const adjusted = isNaN(d)
    ? new Date(Date.now() + HK_UTC_OFFSET_MS)
    : new Date(d.getTime() + HK_UTC_OFFSET_MS);
  const y = adjusted.getUTCFullYear();
  const m = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-${slugify(title)}`;
}

/** Format a date/datetime value as YYYY-MM-DDTHH:MM (local time) for datetime-local inputs. */
function toDateInput(v) {
  const d = new Date(v);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a tags value (array or string) to comma-separated string. */
const toTagsInput = (v) =>
  !v ? '' : Array.isArray(v) ? v.join(', ') : String(v);

/** Return image filenames in a post's images/ directory. */
function getPostImages(slug) {
  const dir = path.join(POSTS_DIR, slug, 'images');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f));
}

/** Return image filenames with pixel dimensions for a post's images/ directory. */
async function getPostImagesWithMeta(slug) {
  const names = getPostImages(slug);
  const dir   = path.join(POSTS_DIR, slug, 'images');
  return Promise.all(
    names.map(async (name) => {
      let width = null, height = null;
      try {
        const meta = await sharp(path.join(dir, name)).metadata();
        width  = meta.width  ?? null;
        height = meta.height ?? null;
      } catch (err) { console.debug(`[cms] could not read dimensions for ${name}:`, err.message); }
      return { name, width, height };
    }),
  );
}

/** Return PDF filenames in a post's files/ directory. */
function getPostFiles(slug) {
  const dir = getPostAssetDir(slug, 'files');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.pdf$/i.test(f));
}

/** Return PDF filenames with sizes for a post's files/ directory. */
async function getPostFilesWithMeta(slug) {
  const names = getPostFiles(slug);
  const dir = getPostAssetDir(slug, 'files');
  return Promise.all(
    names.map(async (name) => {
      let size = null;
      try {
        const stats = await fs.promises.stat(path.join(dir, name));
        size = stats.size ?? null;
      } catch (error) { console.debug(`[cms] could not read size for ${name}:`, error.message); }
      return { name, size };
    }),
  );
}

function formatKilobytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 kb';
  const kb = bytes / 1024;
  const rounded = kb >= 10 ? Math.round(kb) : Math.round(kb * 10) / 10;
  return `${String(rounded).replace(/\.0$/, '')} kb`;
}

function getPostAssetDir(slug, assetDir) {
  if (!validSlug(slug)) {
    throw new Error('Invalid post slug');
  }
  if (!['images', 'files'].includes(assetDir)) {
    throw new Error('Invalid asset directory');
  }
  const dir = path.resolve(POSTS_DIR, slug, assetDir);
  const relToPostsDir = path.relative(POSTS_DIR, dir);
  if (!relToPostsDir || relToPostsDir.startsWith('..') || path.isAbsolute(relToPostsDir)) {
    throw new Error('Invalid asset directory');
  }
  return dir;
}

function makeSafeUploadName(origName) {
  const safeName = path.basename(origName).replace(/[^a-zA-Z0-9.\-_]/g, '_');
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Invalid upload filename');
  }
  return safeName;
}

function getSafeTmpUploadPath(tmpPath) {
  if (typeof tmpPath !== 'string' || !tmpPath) {
    throw new Error('Invalid temporary upload path');
  }
  const resolved = path.resolve(tmpPath);
  const relToTmpDir = path.relative(TMP_DIR, resolved);
  if (!relToTmpDir || relToTmpDir.startsWith('..') || path.isAbsolute(relToTmpDir)) {
    throw new Error('Invalid temporary upload path');
  }
  return resolved;
}

/**
 * Process an uploaded cover image:
 *  – convert to WebP at 75% quality
 *  – save to the post's own images/ directory as <stem>-thumb.webp
 * Returns the final filename.
 */
async function saveCoverImage(tmpPath, slug, origName) {
  const destDir = getPostAssetDir(slug, 'images');
  fs.mkdirSync(destDir, { recursive: true });
  const stem    = path.basename(makeSafeUploadName(origName), path.extname(origName));
  const outName = `${stem}-thumb.webp`;
  const outPath = path.join(destDir, outName);
  // Guard against path traversal in the output filename.
  const relToDestDir = path.relative(destDir, outPath);
  if (!relToDestDir || relToDestDir.startsWith('..') || path.isAbsolute(relToDestDir)) {
    throw new Error('Invalid cover filename');
  }
  await sharp(tmpPath)
    .webp({ quality: 85 })
    .toFile(outPath);
  fs.rmSync(tmpPath, { force: true });
  return outName;
}

async function savePortraitImage(tmpPath, slug, writer, artist) {
  const outName = getPortraitFilename(writer, artist);
  if (!outName) {
    throw new Error('Writer or artist is required for portrait uploads');
  }
  if (!validSlug(slug)) {
    throw new Error('Invalid post slug');
  }
  const safeTmpPath = getSafeTmpUploadPath(tmpPath);
  const destDir = getPostAssetDir(slug, 'images');
  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, outName);
  const relToDestDir = path.relative(destDir, outPath);
  if (!relToDestDir || relToDestDir.startsWith('..') || path.isAbsolute(relToDestDir)) {
    throw new Error('Invalid portrait filename');
  }
  await sharp(safeTmpPath)
    .resize({ width: 240, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(outPath);
  fs.rmSync(safeTmpPath, { force: true });
  return outName;
}

/**
 * Save a portrait image for a specific person (writer or artist).
 * Uses the firstname-lastname.webp naming convention.
 */
async function savePersonPortraitImage(tmpPath, slug, personName) {
  if (!personName || !personName.trim()) {
    throw new Error('Person name is required for portrait uploads');
  }
  if (!validSlug(slug)) {
    throw new Error('Invalid post slug');
  }
  const safeTmpPath = getSafeTmpUploadPath(tmpPath);
  const destDir = getPostAssetDir(slug, 'images');
  fs.mkdirSync(destDir, { recursive: true });

  // Generate filename: firstname-lastname.webp
  const stem = slugifyPersonName(personName.trim());
  const outName = stem ? `${stem}.webp` : '';
  if (!outName) {
    throw new Error('Could not generate portrait filename from person name');
  }

  const outPath = path.join(destDir, outName);
  const relToDestDir = path.relative(destDir, outPath);
  if (!relToDestDir || relToDestDir.startsWith('..') || path.isAbsolute(relToDestDir)) {
    throw new Error('Invalid portrait filename');
  }

  await sharp(safeTmpPath)
    .resize({ width: 240, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(outPath);
  fs.rmSync(safeTmpPath, { force: true });
  return outName;
}

/**
 * Resolve the URL for a cover image.  Covers live inside the post's own
 * images folder and are served at /post-images/<slug>/images/<file>.
 * Legacy covers that were previously stored in COVERS_DIR are also supported.
 */
function coverUrl(slug, cover) {
  if (!cover || !slug) return '';
  // Validate filename – no path separators allowed.
  if (/[/\\]/.test(cover)) return '';
  const postImagesPath = path.resolve(POSTS_DIR, slug, 'images', cover);
  const postImagesDir  = path.resolve(POSTS_DIR, slug, 'images');
  const rel = path.relative(postImagesDir, postImagesPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  if (fs.existsSync(postImagesPath)) {
    return `/post-images/${slug}/images/${cover}`;
  }
  // Fall back to legacy COVERS_DIR location.
  const legacyPath = path.resolve(COVERS_DIR, cover);
  const legacyRel  = path.relative(COVERS_DIR, legacyPath);
  if (!legacyRel || legacyRel.startsWith('..') || path.isAbsolute(legacyRel)) return '';
  if (fs.existsSync(legacyPath)) {
    return `/img/covers/${cover}`;
  }
  return '';
}

/** Copy an extra uploaded image to the post's images/ directory as-is. */
async function saveExtraImage(tmpPath, slug, origName) {
  const safe = makeSafeUploadName(origName);
  const destDir = getPostAssetDir(slug, 'images');
  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, safe);
  const relToDestDir = path.relative(destDir, outPath);
  if (!relToDestDir || relToDestDir.startsWith('..') || path.isAbsolute(relToDestDir)) {
    throw new Error('Invalid image filename');
  }
  fs.copyFileSync(tmpPath, outPath);
  fs.rmSync(tmpPath, { force: true });
  return safe;
}

/** Copy an uploaded PDF to the post's files/ directory as-is. */
async function savePdfFile(tmpPath, slug, origName) {
  const safe = makeSafeUploadName(origName);
  if (!/\.pdf$/i.test(safe)) {
    throw new Error('Invalid PDF filename');
  }
  const destDir = getPostAssetDir(slug, 'files');
  fs.mkdirSync(destDir, { recursive: true });
  const outPath = path.join(destDir, safe);
  const relToDestDir = path.relative(destDir, outPath);
  if (!relToDestDir || relToDestDir.startsWith('..') || path.isAbsolute(relToDestDir)) {
    throw new Error('Invalid PDF filename');
  }
  fs.copyFileSync(tmpPath, outPath);
  fs.rmSync(tmpPath, { force: true });
  return safe;
}

/** Parse multipart form body into a clean YAML data object. */
function parseBody(body, fields = FIELDS) {
  const data = {};

  for (const f of fields) {
    if (f.type === 'checkbox') {
      if (body[f.key] === 'on') data[f.key] = true;
    } else if (f.type === 'tags') {
      const v = body[f.key]?.trim();
      if (v) data[f.key] = v.split(',').map((t) => t.trim()).filter(Boolean);
    } else if (f.type === 'date') {
      const v = body[f.key]?.trim();
      // The datetime-local input contains HKT (UTC+8) time; append the offset so it
      // is stored as the correct UTC instant regardless of the server's local timezone.
      if (v) data[f.key] = new Date(v + HK_UTC_OFFSET);
    } else {
      const v = body[f.key]?.trim();
      if (v) data[f.key] = v;
    }
  }

  if (body.cover?.trim()) data.cover = body.cover.trim();

  // Handle bio- prefixed fields (e.g., bio-john-doe, bio-jane-smith)
  for (const key in body) {
    if (key.startsWith('bio-')) {
      const v = body[key]?.trim();
      if (v) data[key] = v;
    }
  }

  // Handle portrait- prefixed fields (e.g., portrait-john-doe, portrait-jane-smith)
  for (const key in body) {
    if (key.startsWith('portrait-')) {
      const v = body[key]?.trim();
      if (v) data[key] = v;
    }
  }

  // Custom (non-standard) fields
  const ckeys = [].concat(body['custom_key[]']   || body.custom_key   || []);
  const cvals = [].concat(body['custom_value[]'] || body.custom_value || []);
  for (let i = 0; i < ckeys.length; i++) {
    const k = (ckeys[i] || '').trim();
    if (k && !KNOWN_KEYS.includes(k)) {
      data[k] = (cvals[i] || '').trim();
    }
  }

  return data;
}

// ─── HTML templates ───────────────────────────────────────────────────────────

/** Full page wrapper using Pico.css classless theme. */
function layout(title, body) {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} – aplus CMS</title>
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.classless.min.css">
  <style>
    /* ── Layout ── */
    body  { max-width: 1150px; margin: 0 auto; padding: 0 1rem 3rem; }
    header {
      background: #1d3557; color: #fff;
      padding: .8rem 1.5rem; margin-bottom: 2rem;
      border-radius: 0 0 8px 8px;
    }
    header a  { color: #fff; text-decoration: none; }
    header nav {
      display: flex; justify-content: space-between; align-items: center;
    }
    .theme-toggle {
      background: none; border: 1px solid rgba(255, 255, 255, 0.3);
      color: #fff; cursor: pointer; padding: 0.4rem 0.8rem;
      border-radius: 4px; font-size: 0.9em; transition: all 0.2s;
    }
    .theme-toggle:hover {
      background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.5);
    }
    /* ── Utilities ── */
    .badge { font-size:.72em; padding:2px 7px; border-radius:99px;
             background:#e63946; color:#fff; vertical-align:middle; }
    .alert { padding:.7rem 1rem; border-radius:6px; margin-bottom:1rem; }
    .alert-success { background:#d1e7dd; color:#0a3622; }
    .alert-error   { background:#f8d7da; color:#58151c; }
    .section-title {
      font-size:1.05em; font-weight:700; color:#1d3557;
      border-bottom:2px solid #1d3557; padding-bottom:.25rem; margin-bottom:1rem;
    }
    /* ── Post list ── */
    .cover-thumb       { width:48px; height:60px; object-fit:cover; border-radius:4px; }
    .cover-placeholder { width:48px; height:60px; background:#cce0f0; border-radius:4px;
                         display:flex; align-items:center; justify-content:center; }
    .actions          { display:flex; gap:.4rem; flex-wrap:wrap; align-items:center; }
    .actions form     { margin:0; }
    .btn-sm           { padding:.3rem .65rem; font-size:.85em; line-height:1.4;
                        display:inline-flex; align-items:center; justify-content:center; }
    .btn-grey         { background:#6c757d; border-color:#6c757d; color:#fff; }
    .btn-red          { background:#dc3545; border-color:#dc3545; color:#fff; }
.post-inline-actions form {
  display: inline;
  margin: 0;
}
    /* ── Pagination ── */
    .pagination       { display:flex; gap:.4rem; justify-content:center;
                        flex-wrap:wrap; margin-top:2rem; }
    .pagination a,
    .pagination span  { padding:.35rem .75rem; border:1px solid #ccc;
                        border-radius:4px; text-decoration:none; }
    .pagination .active { background:#1d3557; color:#fff; border-color:#1d3557; }
    /* ── Edit form ── */
    .field-grid {
      display:grid; grid-template-columns:1fr 1fr; gap:.75rem 1rem;
    }
    .field-grid .span2 { grid-column:1/-1; }
    .field-hidden      { display:none; }
    .check-row        { display:flex; gap:2rem; flex-wrap:wrap; }
    .custom-row       { display:flex; gap:.5rem; margin-bottom:.5rem; align-items:start; }
    .custom-row input { flex:1; margin:0; }
    /* ── Image gallery ── */
    .img-gallery { display:flex; flex-direction:column; gap:.5rem; margin-top:.5rem; }
    .img-item    { display:flex; flex-direction:row; align-items:flex-start; gap:.75rem;
                   padding:.5rem; border:1px solid #eee; border-radius:4px; }
    .img-item img      { width:80px; height:80px; object-fit:cover;
                         border-radius:4px; border:1px solid #ddd; flex-shrink:0; }
    .img-item-info     { display:flex; flex-direction:column; gap:.3rem; min-width:0; flex:1; }
    .img-item span     { font-size:.75em; color:#333;
                         overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .img-dims          { font-size:.7em; color:#777; }
    .img-item-btns     { display:flex; gap:.4rem; flex-wrap:wrap; align-items:center; }
    .copy-btn       { font-size:.7em; padding:2px 6px; cursor:pointer; }
    .img-del-btn    { font-size:.75em; padding:1px 5px; cursor:pointer; line-height:1.4;
                      background:#dc3545; border-color:#dc3545; color:#fff;
                      border-radius:3px; border:none; }
    /* ── Responsive (≤ 700 px) ── */
    @media (max-width: 700px) {
      .col-writer  { display:none; }
      .col-actions { display:none; }
      .col-slug    { display:none; }
      .post-inline-actions { display:flex !important; }
.post-inline-actions form {
  display: inline;
  margin: 0;
}
    }
    /* ── Search bar ── */
    .search-wrap { position:relative; margin-bottom:1.25rem; }
    .search-wrap input[type="search"] {
      width:100%; margin:0; padding:.5rem .75rem;
      border:1px solid #ccc; border-radius:6px; font-size:.95em;
    }
    .search-wrap input[type="search"]:focus { border-color:#1d3557; }
    .search-dropdown {
      position:absolute; top:calc(100% + 4px); left:0; right:0;
      background:#fff; border:1px solid #ccc; border-radius:6px;
      box-shadow:0 4px 12px rgba(0,0,0,.12);
      max-height:320px; overflow-y:auto; z-index:200;
      display:none;
    }
    .search-dropdown.open { display:block; }
    .search-item {
      padding:.55rem .85rem; cursor:pointer;
      border-bottom:1px solid #f0f0f0; display:flex;
      justify-content:space-between; align-items:baseline; gap:.5rem;
    }
    .search-item:last-child { border-bottom:none; }
    .search-item:hover, .search-item.active {
      background:#e8f0fe;
    }
    .search-item-title { font-weight:500; }
    .search-item-meta  { font-size:.78em; color:#777; white-space:nowrap; }
    .search-empty { padding:.6rem .85rem; color:#888; font-size:.9em; }
    /* ── Misc ── */
    textarea[name="content"] { font-family:monospace; font-size:.88em; }
    small { color:#666; }
    details summary { cursor:pointer; font-weight:600; }
    .post-inline-actions { display:none; gap:.4rem; flex-wrap:wrap;
                           align-items:center; margin-top:.35rem; }
    .post-inline-actions form { margin:0; }
  </style>
</head>
<body>
  <header>
    <nav>
      <a href="/"><strong>📚 aplus CMS</strong></a>
      <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme">
        <span id="theme-icon">🌙</span>
      </button>
    </nav>
  </header>
  <main>${body}</main>

  <script>
    // Theme management
    (function() {
      const html = document.documentElement;
      const themeIcon = document.getElementById('theme-icon');
      
      function updateThemeIcon(theme) {
        if (themeIcon) {
          themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
      }
      
      // Load saved theme or default to light
      const savedTheme = localStorage.getItem('cms-theme') || 'light';
      html.setAttribute('data-theme', savedTheme);
      updateThemeIcon(savedTheme);
      
      window.toggleTheme = function() {
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('cms-theme', newTheme);
        updateThemeIcon(newTheme);
      };
    })();
  </script>

  <script>
    /**
     * Slugify a person's name for portrait filenames (client-side version).
     * 
     * IMPORTANT: This function must match slugifyPersonName() in the server-side code
     * and generateFilename() in scripts/fetch-writer-photos.js to ensure consistent
     * filename generation across all systems.
     * 
     * The normalization logic is duplicated (not shared) because:
     * 1. Client-side code needs to work independently
     * 2. The logic is simple and unlikely to change
     * 3. Keeping it inline avoids build/bundling complexity
     * 
     * Normalization steps:
     * 1. Normalize to NFKD (decompose characters with diacritics)
     * 2. Remove diacritic marks (U+0300 to U+036F)
     * 3. Convert to lowercase
     * 4. Replace non-alphanumeric sequences with dashes
     * 5. Remove leading/trailing dashes
     * 6. Truncate to max length
     */
    function slugifyPortraitName(value) {
      return String(value == null ? '' : value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, ${MAX_SLUG_LENGTH});
    }

    /**
     * Legacy slugify function (without diacritic normalization).
     * Used for backwards compatibility with files created before the fix.
     */
    function slugifyPortraitNameLegacy(value) {
      return String(value == null ? '' : value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, ${MAX_SLUG_LENGTH});
    }

    /* Dynamic bio/portrait fields: regenerate based on writer or artist changes */
    (function () {
      const writerInput = document.getElementById('f-writer');
      const artistInput = document.getElementById('f-artist');
      const bioPortraitContainer = document.getElementById('bio-portrait-container');
      const postForm = document.getElementById('post-form');
      const existingImagesInput = document.getElementById('existing-image-names');
      let existingImages = new Set();
      if (existingImagesInput) {
        try {
          existingImages = new Set(JSON.parse(existingImagesInput.value || '[]'));
        } catch (_error) {
          existingImages = new Set();
        }
      }

      function updateBioPortraitFields() {
        if (!bioPortraitContainer) return;

        const writers = (writerInput ? writerInput.value : '').split(',').map(w => w.trim()).filter(Boolean);
        const artists = (artistInput ? artistInput.value : '').split(',').map(a => a.trim()).filter(Boolean);
        const people = [...writers, ...artists];

        if (people.length === 0) {
          bioPortraitContainer.innerHTML = '';
          bioPortraitContainer.className = 'span2 field-hidden';
          return;
        }

        // Generate fields for each person
        let fieldsHTML = '';
        people.forEach((person, idx) => {
          const slugifiedPerson = slugifyPortraitName(person);
          const bioKey = \`bio-\${slugifiedPerson}\`;
          const portraitKey = \`portrait-\${slugifiedPerson}\`;
          const portraitFilename = \`\${slugifiedPerson}.webp\`;
          const portraitExists = existingImages.has(portraitFilename);
          const portraitStatus = portraitExists
            ? \`<small id="portrait-existing-status-\${idx}">Existing portrait: <strong>\${portraitFilename}</strong></small>\`
            : \`<small id="portrait-existing-status-\${idx}"></small>\`;

          // Try to preserve existing bio value if already in form
          const existingBioField = document.querySelector(\`[name="\${bioKey}"]\`);
          const bioValue = existingBioField ? existingBioField.value : '';

          // Try to preserve existing portrait value if already in form
          const existingPortraitField = document.querySelector(\`[name="\${portraitKey}"]\`);
          const portraitValue = existingPortraitField ? existingPortraitField.value : '';

          fieldsHTML += \`
            <div class="span2 bio-portrait-group" data-person="\${person}">
              <label for="f-\${bioKey}">Bio for \${person}
                <textarea id="f-\${bioKey}" name="\${bioKey}" rows="4">\${bioValue}</textarea>
              </label>
            </div>
            <div class="span2 bio-portrait-group" data-person="\${person}">
              <label for="f-portrait-upload-\${idx}">Upload portrait for \${person}
                <small>Saved in <code>images/</code> as <code>\${portraitFilename}</code> and resized to 240 px wide WebP.</small>
                \${portraitStatus}
                <input type="hidden" name="\${portraitKey}" value="\${portraitValue}">
                <input type="hidden" id="portrait-overwrite-confirmed-\${idx}" name="portrait_overwrite_confirmed_\${slugifiedPerson}" value="">
                <input type="file" id="f-portrait-upload-\${idx}" name="portrait_upload_\${slugifiedPerson}" accept="image/*" data-person-name="\${person}">
              </label>
            </div>\`;
        });

        bioPortraitContainer.innerHTML = fieldsHTML;
        bioPortraitContainer.className = 'span2';
        bioPortraitContainer.style.display = 'contents';

        // Attach overwrite confirmation to each portrait upload
        people.forEach((person, idx) => {
          const slugifiedPerson = slugifyPortraitName(person);
          const portraitInput = document.getElementById(\`f-portrait-upload-\${idx}\`);
          const overwriteConfirmed = document.getElementById(\`portrait-overwrite-confirmed-\${idx}\`);
          const portraitFilename = \`\${slugifiedPerson}.webp\`;

          if (portraitInput) {
            portraitInput.addEventListener('change', function () {
              if (!portraitInput.files || portraitInput.files.length === 0) {
                if (overwriteConfirmed) overwriteConfirmed.value = '';
                return;
              }
              if (existingImages.has(portraitFilename)) {
                const ok = confirm(\`Are you sure you want to overwrite the existing portrait for \${person}?\`);
                if (overwriteConfirmed) overwriteConfirmed.value = ok ? '1' : '';
                if (!ok) portraitInput.value = '';
              } else {
                if (overwriteConfirmed) overwriteConfirmed.value = '';
              }
            });
          }
        });
      }

      if (writerInput) writerInput.addEventListener('input', updateBioPortraitFields);
      if (artistInput) artistInput.addEventListener('input', updateBioPortraitFields);

      // Initialize on page load
      updateBioPortraitFields();
    })();

    /* Auto-fill current date/time for new posts (when date field is empty) */
    (function () {
      const dt = document.getElementById('f-date');
      if (dt && !dt.value) {
        const now = new Date();
        const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const pad = n => String(n).padStart(2, '0');
        dt.value = utc8.getUTCFullYear() + '-' + pad(utc8.getUTCMonth() + 1) + '-' + pad(utc8.getUTCDate()) + 'T' + pad(utc8.getUTCHours()) + ':' + pad(utc8.getUTCMinutes());
      }
    })();

    /* Post Slug: auto-populate from Title (and Date) on both new and edit forms */
    (function () {
      const titleInput = document.getElementById('f-title');
      const slugInput  = document.getElementById('f-post-slug');
      const dateInput  = document.getElementById('f-date');
      if (!titleInput || !slugInput) return;

      function slugifyTitle(s) {
        return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, ${MAX_SLUG_LENGTH});
      }

      function getYearMonth() {
        const v = dateInput ? dateInput.value : '';
        if (v) {
          const datePart = v.split('T')[0].split('-');
          if (datePart.length >= 2) return { y: datePart[0], m: datePart[1] };
        }
        const now = new Date();
        return { y: now.getFullYear(), m: String(now.getMonth() + 1).padStart(2, '0') };
      }

      function updateSlug() {
        const t = titleInput.value.trim();
        if (!t) { slugInput.value = ''; return; }
        const { y, m } = getYearMonth();
        slugInput.value = y + '-' + m + '-' + slugifyTitle(t);
      }

      titleInput.addEventListener('input', updateSlug);
      if (dateInput) dateInput.addEventListener('input', updateSlug);
      updateSlug(); // initial render
    })();

    /* Warn the user if they attempt to edit the read-only Post Slug field */
    function warnSlugReadOnly(event, msg) {
      if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
        alert(msg);
      }
    }

    const DEFAULT_SIZING_WIDTH = '60%';
    function escapeShortcodeValue(value) {
      return JSON.stringify(String(value == null ? '' : value)).slice(1, -1);
    }
    function buildSizingShortcode(imageName) {
      const titleInput = document.getElementById('f-title');
      const postTitle = titleInput ? titleInput.value.trim() : '';
      return '{% sizing "' + escapeShortcodeValue(imageName) + '", "' + DEFAULT_SIZING_WIDTH + '", "' + escapeShortcodeValue(postTitle) + '" %}';
    }

    /* Copy text to clipboard; uploaded image buttons build sizing shortcodes */
    function copyText(event) {
      const btn  = event.currentTarget;
      const text = btn.dataset.imageName
        ? buildSizingShortcode(btn.dataset.imageName)
        : (btn.dataset.copyText || btn.dataset.shortcode);
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    }

    /* Confirm before deleting a post; title stored in data-title attribute on the form */
    function confirmDelete(form) {
      return confirm('Delete «' + form.dataset.title + '»? This cannot be undone.');
    }

    /* Confirm before deleting an image */
    function confirmImageDelete(form) {
      return confirm('Are you sure you want to delete ' + form.dataset.filename + ' permanently?');
    }

    /* Custom field management – uses DOM methods to avoid innerHTML XSS risk */
    function addCustomField() {
      const c = document.getElementById('custom-fields');
      const row = document.createElement('div');
      row.className = 'custom-row';

      const ki = document.createElement('input');
      ki.type = 'text'; ki.name = 'custom_key[]'; ki.placeholder = 'field_name';

      const vi = document.createElement('input');
      vi.type = 'text'; vi.name = 'custom_value[]'; vi.placeholder = 'value';

      const rm = document.createElement('button');
      rm.type = 'button'; rm.title = 'Remove'; rm.textContent = '✕';
      rm.onclick = () => row.remove();

      row.appendChild(ki); row.appendChild(vi); row.appendChild(rm);
      c.appendChild(row);
    }

    /* Post search typeahead */
    (function () {
      const wrap  = document.getElementById('post-search-wrap');
      if (!wrap) return;
      const input = wrap.querySelector('input[type="search"]');
      const drop  = wrap.querySelector('.search-dropdown');
      let activeIdx = -1;
      let debounceTimer;

      function getItems() {
        return Array.from(drop.querySelectorAll('.search-item'));
      }

      function setActive(idx) {
        const items = getItems();
        items.forEach((el, i) => el.classList.toggle('active', i === idx));
        activeIdx = idx;
      }

      function open(html) {
        drop.innerHTML = html;
        drop.classList.add('open');
        activeIdx = -1;
      }

      function close() {
        drop.classList.remove('open');
        drop.innerHTML = '';
        activeIdx = -1;
      }

      function navigate(slug) {
        if (slug) window.location.href = '/post/' + encodeURIComponent(slug) + '/edit';
      }

      input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        const q = input.value.trim();
        if (!q) { close(); return; }
        debounceTimer = setTimeout(async function () {
          try {
            const res  = await fetch('/api/search?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (!data.length) {
              open('<div class="search-empty">No posts found</div>');
              return;
            }
            const html = data.map(function (p) {
              const draftMark = p.draft ? ' <span class="badge">draft</span>' : '';
              const writerParen = p.writer ? ' (' + escHtml(p.writer) + ')' : '';
              return '<div class="search-item" data-slug="' + escAttr(p.slug) + '">' +
                '<span class="search-item-title">' + escHtml(p.title) + writerParen + draftMark + '</span>' +
                '</div>';
            }).join('');
            open(html);
            drop.querySelectorAll('.search-item').forEach(function (el) {
              el.addEventListener('mousedown', function (e) {
                e.preventDefault();
                navigate(el.dataset.slug);
              });
            });
          } catch (e) { console.error('[search]', e); }
        }, 200);
      });

      input.addEventListener('keydown', function (e) {
        const items = getItems();
        if (!drop.classList.contains('open')) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (items.length) setActive(Math.min(activeIdx + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive(Math.max(activeIdx - 1, -1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const active = items[activeIdx];
          if (active) navigate(active.dataset.slug);
          else close();
        } else if (e.key === 'Escape') {
          close();
        }
      });

      document.addEventListener('click', function (e) {
        if (!wrap.contains(e.target)) close();
      });

      function escHtml(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
      function escAttr(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      }
    })();

    /* Preview button: open Eleventy local server if running, else CMS preview */
    (function () {
      var previewBtn = document.getElementById('btn-preview');
      if (!previewBtn) return;
      previewBtn.addEventListener('click', function () {
        var slug = previewBtn.dataset.slug || '';
        if (!slug) { fallbackPreview(); return; }
        // Open a blank window synchronously so popup blockers don't interfere,
        // then navigate it once we know whether Eleventy is running.
        var newWin = window.open('', '_blank');
        if (!newWin) { fallbackPreview(); return; }
        fetch('/api/eleventy-status')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.running) {
              newWin.location.href = 'http://localhost:8080/posts/' + encodeURIComponent(slug) + '/';
            } else {
              newWin.close();
              fallbackPreview();
            }
          })
          .catch(function () {
            newWin.close();
            fallbackPreview();
          });
      });

      function fallbackPreview() {
        var form = document.getElementById('post-form');
        if (!form) return;
        var origAction = form.action;
        var origTarget = form.target;
        form.action = '/post/preview';
        form.target = '_blank';
        form.submit();
        form.action = origAction;
        form.target = origTarget;
      }
    })();

  </script>
</body>
</html>`;
}

/** Render a single form field based on its type. */
function renderField(f, value) {
  const id  = `f-${f.key}`;
  const req = f.required ? ' required' : '';

  if (f.type === 'checkbox') {
    return `<label><input type="checkbox" id="${id}" name="${f.key}"${value ? ' checked' : ''}> ${esc(f.label)}</label>`;
  }
  if (f.type === 'date') {
    return `<label for="${id}">${esc(f.label)}<input type="datetime-local" id="${id}" name="${f.key}" value="${esc(toDateInput(value))}"></label>`;
  }
  if (f.type === 'tags') {
    return `<label for="${id}">${esc(f.label)} <small>(comma-separated)</small><input type="text" id="${id}" name="${f.key}" value="${esc(toTagsInput(value))}" placeholder="e.g. travel, food, tips"></label>`;
  }
  if (f.type === 'textarea') {
    return `<label for="${id}">${esc(f.label)}<textarea id="${id}" name="${f.key}" rows="${f.rows || 4}">${esc(value || '')}</textarea></label>`;
  }
  if (f.type === 'hidden') {
    return `<input type="hidden" id="${id}" name="${f.key}" value="${esc(value || '')}">`;
  }
  return `<label for="${id}">${esc(f.label)}<input type="text" id="${id}" name="${f.key}" value="${esc(value || '')}"${req}></label>`;
}

/** Render the create / edit form. */
async function postFormPage(slug, post, isNew, flash = '') {
  const d       = post?.data    || {};
  const content = post?.content || '';
  const images  = (slug && !isNew) ? await getPostImagesWithMeta(slug) : [];
  const pdfs    = (slug && !isNew) ? await getPostFilesWithMeta(slug) : [];
  const portraitFilename = getPortraitFilename(d.writer, d.artist);
  const portraitAlreadyExists = !!(slug && !isNew && portraitFilename && images.some((img) => img.name === portraitFilename));

  // Cover preview with delete button.
  // Rendered OUTSIDE the main <form> to avoid invalid nested-form HTML.
  const coverPreview = (d.cover && slug && !isNew)
    ? `<div style="margin-top:.5rem;display:flex;align-items:flex-start;gap:.75rem">
         <img src="${esc(coverUrl(slug, d.cover))}"
              alt="cover" style="width:100px;height:auto;border-radius:4px;border:1px solid #ddd">
         <div>
            <small style="display:block;margin-bottom:.4rem">Current: ${esc(d.cover)}</small>
            <div class="img-item-btns">
              <button type="button" class="copy-btn"
                      data-image-name="${esc(d.cover)}"
                      onclick="copyText(event)"
              >Copy</button>
             <form method="POST" action="/post/${esc(slug)}/image-delete"
                   data-filename="${esc(d.cover)}"
                   onsubmit="return confirmImageDelete(this)"
                   style="margin:0">
               <input type="hidden" name="filename" value="${esc(d.cover)}">
               <input type="hidden" name="type" value="cover">
               <button type="submit" class="img-del-btn">✕ Delete cover</button>
             </form>
           </div>
         </div>
       </div>`
    : '';

  // Image gallery with per-image delete forms.
  // Also rendered OUTSIDE the main <form>.
  const imgGallery = images.length
    ? `<div class="img-gallery">
          ${images.map((img) => {
            return `<div class="img-item">
                      <img src="/post-images/${esc(slug)}/images/${esc(img.name)}" alt="${esc(img.name)}">
                      <div class="img-item-info">
                       <span title="${esc(img.name)}">${esc(img.name)}</span>
                       ${img.width !== null && img.height !== null
                         ? `<span class="img-dims">${img.width} × ${img.height} px</span>`
                         : ''}
                        <div class="img-item-btns">
                          <button type="button" class="copy-btn"
                                  data-image-name="${esc(img.name)}"
                                  onclick="copyText(event)"
                          >Copy</button>
                         <form method="POST" action="/post/${esc(slug)}/image-delete"
                               data-filename="${esc(img.name)}"
                               onsubmit="return confirmImageDelete(this)"
                               style="margin:0">
                           <input type="hidden" name="filename" value="${esc(img.name)}">
                           <input type="hidden" name="type" value="image">
                           <button type="submit" class="img-del-btn">✕ Delete</button>
                         </form>
                       </div>
                     </div>
                   </div>`;
         }).join('')}
       </div>`
     : '<small>No images uploaded yet.</small>';

  const pdfGallery = pdfs.length
    ? `<div class="img-gallery">
         ${pdfs.map((file) => {
           const sizeLabel = formatKilobytes(file.size ?? 0);
           const copyMarkup = `<a href="./files/${file.name}">${file.name}</a> (${sizeLabel})`;
           return `<div class="img-item">
                     <div class="img-item-info">
                      <a href="/post-images/${esc(slug)}/files/${esc(file.name)}" target="_blank" rel="noopener noreferrer" title="${esc(file.name)}">${esc(file.name)}</a>
                      <span class="img-dims">${esc(sizeLabel)}</span>
                       <div class="img-item-btns">
                         <button type="button" class="copy-btn"
                                 data-copy-text="${esc(copyMarkup)}"
                                 onclick="copyText(event)"
                         >Copy</button>
                        <form method="POST" action="/post/${esc(slug)}/image-delete"
                              data-filename="${esc(file.name)}"
                              onsubmit="return confirmImageDelete(this)"
                              style="margin:0">
                          <input type="hidden" name="filename" value="${esc(file.name)}">
                          <input type="hidden" name="type" value="file">
                          <button type="submit" class="img-del-btn">✕ Delete</button>
                        </form>
                      </div>
                    </div>
                  </div>`;
         }).join('')}
       </div>`
    : '';

  // Custom fields (keys not in KNOWN_KEYS)
  const customFields = Object.entries(d)
    .filter(([k]) => !KNOWN_KEYS.includes(k))
    .map(([k, v]) =>
      `<div class="custom-row">
         <input type="text" name="custom_key[]"   value="${esc(k)}"          placeholder="field_name">
         <input type="text" name="custom_value[]" value="${esc(String(v || ''))}" placeholder="value">
         <button type="button" onclick="this.closest('.custom-row').remove()" title="Remove">✕</button>
       </div>`,
    )
    .join('');

  const action = isNew ? '/post/create' : `/post/${esc(slug)}/update`;
  const pageTitle = isNew ? 'New Post' : `Edit: ${esc(d.title || slug)}`;

  return layout(pageTitle, /* html */ `
    ${flash}
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.5rem">
      <h2 style="margin:0">${pageTitle}</h2>
      ${!isNew ? `<a href="/">← All Posts</a>` : ''}
    </div>

    <form id="post-form" method="POST" action="${action}" enctype="multipart/form-data">
      <!-- Hidden field carries the slug to the preview endpoint -->
      <input type="hidden" name="_slug" value="${isNew ? '' : esc(slug)}">
      <input type="hidden" id="existing-image-names" value="${esc(JSON.stringify(images.map((img) => img.name)))}">

      <!-- ── Front Matter ───────────────────────────────────── -->
      <section>
        <p class="section-title">📝 Front Matter</p>
        <div class="field-grid">
          ${FIELDS
            .filter((f) => !['checkbox', 'textarea'].includes(f.type))
            .map((f) => {
              if (f.key === 'title') {
                const slugVal  = isNew ? '' : esc(slug || '');
                const slugHint = isNew
                  ? '<small>(auto-generated from Title and Date)</small>'
                  : '<small>(auto-updated from Title and Date — changes on save)</small>';
                const alertMsg = isNew
                  ? 'Post Slug is auto-generated from the Title. To change it, edit the Title above.'
                  : 'Post Slug is auto-updated from the Title and Date. To change it, edit the Title or Date fields above.';
                const slugField = `<div class="span2">
                  <label for="f-post-slug">Post Slug ${slugHint}
                    <input type="text" id="f-post-slug" value="${slugVal}" readonly
                           autocomplete="off"
                           style="background:#f5f5f5;cursor:default"
                     onkeydown="warnSlugReadOnly(event, ${JSON.stringify(alertMsg)})">
                  </label>
                </div>`;
                return `<div class="span2">${renderField(f, d[f.key])}</div>\n          ${slugField}`;
              }
              return `<div>${renderField(f, d[f.key])}</div>`;
            })
            .join('')}
          ${FIELDS
            .filter((f) => f.type === 'textarea')
            .map((f) => {
              if (f.conditional === 'writer_or_artist') {
                // Generate dynamic bio/portrait fields for each writer/artist
                const writers = (d.writer || '').split(',').map(w => w.trim()).filter(Boolean);
                const artists = (d.artist || '').split(',').map(a => a.trim()).filter(Boolean);
                const people = [...writers, ...artists];

                if (people.length === 0) {
                  // No writers or artists - show placeholder
                  return `<div id="bio-portrait-container" class="span2 field-hidden"></div>`;
                }

                // Generate a bio textarea and portrait upload for each person
                const fields = people.map((person, idx) => {
                  const slugifiedPerson = slugifyPersonName(person);
                  const bioKey = `bio-${slugifiedPerson}`;
                  const portraitKey = `portrait-${slugifiedPerson}`;
                  const bioValue = d[bioKey] || '';
                  const portraitValue = d[portraitKey] || '';
                  const portraitFilename = `${slugifiedPerson}.webp`;
                  const portraitExists = !!(slug && !isNew && images.some((img) => img.name === portraitFilename));
                  const portraitStatus = portraitExists
                    ? `<small id="portrait-existing-status-${idx}">Existing portrait: <strong>${esc(portraitFilename)}</strong></small>`
                    : `<small id="portrait-existing-status-${idx}"></small>`;

                  return `
                    <div class="span2 bio-portrait-group" data-person="${esc(person)}">
                      <label for="f-${bioKey}">Bio for ${esc(person)}
                        <textarea id="f-${bioKey}" name="${bioKey}" rows="4">${esc(bioValue)}</textarea>
                      </label>
                    </div>
                    <div class="span2 bio-portrait-group" data-person="${esc(person)}">
                      <label for="f-portrait-upload-${idx}">Upload portrait for ${esc(person)}
                        <small>Saved in <code>images/</code> as <code>${esc(portraitFilename)}</code> and resized to 240 px wide WebP.</small>
                        ${portraitStatus}
                        <input type="hidden" name="${portraitKey}" value="${esc(portraitValue)}">
                        <input type="hidden" id="portrait-overwrite-confirmed-${idx}" name="portrait_overwrite_confirmed_${slugifiedPerson}" value="">
                        <input type="file" id="f-portrait-upload-${idx}" name="portrait_upload_${slugifiedPerson}" accept="image/*" data-person-name="${esc(person)}">
                      </label>
                    </div>`;
                }).join('');

                return `<div id="bio-portrait-container" class="span2" style="display:contents">${fields}</div>`;
              }
              return `<div class="span2">${renderField(f, d[f.key])}</div>`;
            })
            .join('')}
        </div>
        <div class="check-row" style="margin-top:.5rem">
          ${FIELDS
            .filter((f) => f.type === 'checkbox')
            .map((f) => renderField(f, d[f.key]))
            .join('')}
        </div>
      </section>

      <!-- ── Cover Image ───────────────────────────────────── -->
      <section>
        <p class="section-title">🖼️ Cover Image</p>
        ${d.cover && slug && !isNew
          ? `<p><small>Current cover: <strong>${esc(d.cover)}</strong> — use the Image Management section below to delete it.</small></p>`
          : ''}
        <label>Upload cover image
          <small>(converted to WebP at 75% quality, saved as <code>&lt;original-name-without-extension&gt;-thumb.webp</code> in this post's <code>images/</code> directory)</small>
          <input type="file" name="cover_upload" accept="image/*">
        </label>
        <label>Cover filename <small>(YAML value – auto-filled on upload)</small>
          <input type="text" name="cover" value="${esc(d.cover || '')}" placeholder="cover.webp">
        </label>
      </section>

      <!-- ── Extra Images ──────────────────────────────────── -->
      <section>
        <p class="section-title">📁 Post Images</p>
        <label>Upload additional images
          <small>(stored as-is in <code>images/</code>; use Copy button to insert a sizing shortcode)</small>
          <input type="file" name="extra_images" accept="image/*" multiple>
        </label>
        ${images.length
          ? `<p style="margin-top:.5rem"><small>${images.length} image(s) uploaded — use the Image Management section below to delete any.</small></p>`
          : ''}
      </section>

      <section>
        <p class="section-title">📄 Upload PDFs</p>
        <label>Upload PDF files
          <small>(stored as-is in <code>files/</code>)</small>
          <input type="file" name="extra_pdfs" accept="application/pdf,.pdf" multiple>
        </label>
        ${pdfs.length
          ? `<p style="margin-top:.5rem"><small>${pdfs.length} PDF file(s) uploaded — use the File Management section below to copy or delete any.</small></p>`
          : ''}
      </section>

      <!-- ── Custom YAML Fields ────────────────────────────── -->
      <section>
        <details${Object.keys(d).some((k) => !KNOWN_KEYS.includes(k)) ? ' open' : ''}>
          <summary class="section-title" style="border:none;margin-bottom:.5rem">⚙️ Custom YAML Fields</summary>
          <small>Any extra front-matter keys not in the standard set above.</small>
          <div id="custom-fields" style="margin-top:.75rem">${customFields}</div>
          <button type="button" onclick="addCustomField()" style="margin-top:.5rem">＋ Add Field</button>
        </details>
      </section>

      <!-- ── Markdown Content ──────────────────────────────── -->
      <section>
        <p class="section-title">📄 Markdown Content</p>
        <textarea name="content" rows="22">${esc(content)}</textarea>
      </section>

    </form>

    <!-- ── Image Management ──────────────────────────────────
         These forms are intentionally placed OUTSIDE the main edit <form>
         above. HTML does not allow nested <form> elements; nesting causes
         browsers to prematurely close the outer form, which means the
         content <textarea> and Save button would be excluded from the
         submission. Image deletion is a separate operation from saving
         post data, so keeping it in standalone forms here is correct.
    ─────────────────────────────────────────────────────────── -->
    ${(slug && !isNew) ? `
    <section style="margin-top:1.5rem">
      <p class="section-title">🗂️ Image Management</p>
      ${d.cover
        ? `<div style="margin-bottom:1rem">
             <strong>Cover image</strong>
             ${coverPreview}
           </div>`
        : ''}
      <div>
         <strong>Images available for this post</strong>
         ${imgGallery}
       </div>
     </section>` : ''}

    ${(slug && !isNew && pdfs.length) ? `
    <section style="margin-top:1.5rem">
      <p class="section-title">🗂️ File Management</p>
      <div>
        <strong>PDF files available for this post</strong>
        ${pdfGallery}
      </div>
    </section>` : ''}

    <!-- ── Actions ──────────────────────────────────────── -->
    <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin-top:1.5rem">
      <button type="submit" form="post-form">💾 Save Post</button>
      <button type="button"
              id="btn-preview"
              data-slug="${isNew ? '' : esc(slug)}"
              style="background:#457b9d;border-color:#457b9d;color:#fff"
      >👁 Preview</button>
      ${!isNew
        ? `<a href="/post/${esc(slug)}/preview" target="_blank" style="margin-left:auto">🔗 Preview saved</a>`
        : ''}
    </div>
  `);
}

/** Render the create / edit form for Share posts. */
async function shareFormPage(slug, post, isNew, flash = '') {
  const d       = post?.data    || {};
  const content = post?.content || '';
  const images  = (slug && !isNew) ? await getPostImagesWithMeta(slug) : [];

  // Ensure tags contains 'share'
  if (!d.tags) d.tags = ['share'];
  else if (!Array.isArray(d.tags)) d.tags = ['share'];
  else if (!d.tags.includes('share')) d.tags.push('share');

  // Image gallery with per-image delete forms
  const imgGallery = images.length
    ? `<div class="img-gallery">
          ${images.map((img) => {
            // For Share posts, use the figure shortcode with absolute path.
            // Strip any character outside the multer-safe set to prevent shortcode injection.
            const safeNameForShortcode = img.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
            const figureSyntax = `{% figure "/posts/${slug}/images/${safeNameForShortcode}", "${safeNameForShortcode}", "" %}`;
            return `<div class="img-item">
                      <img src="/post-images/${esc(slug)}/images/${esc(img.name)}" alt="${esc(img.name)}">
                      <div class="img-item-info">
                       <span title="${esc(img.name)}">${esc(img.name)}</span>
                       ${img.width !== null && img.height !== null
                         ? `<span class="img-dims">${img.width} × ${img.height} px</span>`
                         : ''}
                        <div class="img-item-btns">
                          <button type="button" class="copy-btn"
                                  data-copy-text="${esc(figureSyntax)}"
                                  onclick="copyText(event)"
                          >Copy</button>
                         <form method="POST" action="/share/${esc(slug)}/image-delete"
                               data-filename="${esc(img.name)}"
                               onsubmit="return confirmImageDelete(this)"
                               style="margin:0">
                           <input type="hidden" name="filename" value="${esc(img.name)}">
                           <input type="hidden" name="type" value="image">
                           <button type="submit" class="img-del-btn">✕ Delete</button>
                         </form>
                       </div>
                     </div>
                   </div>`;
         }).join('')}
       </div>`
     : '<small>No images uploaded yet.</small>';

  const action = isNew ? '/share/create' : `/share/${esc(slug)}/update`;
  const pageTitle = isNew ? 'New Share' : `Edit Share: ${esc(d.title || slug)}`;

  return layout(pageTitle, /* html */ `
    ${flash}
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.5rem">
      <h2 style="margin:0">${pageTitle}</h2>
      ${!isNew ? `<a href="/">← All Posts</a>` : ''}
    </div>

    <form id="post-form" method="POST" action="${action}" enctype="multipart/form-data">
      <!-- Hidden field carries the slug to the preview endpoint -->
      <input type="hidden" name="_slug" value="${isNew ? '' : esc(slug)}">
      <!-- Hidden tags field always contains 'share' -->
      <input type="hidden" name="tags" value="share">
      <input type="hidden" id="existing-image-names" value="${esc(JSON.stringify(images.map((img) => img.name)))}">

      <!-- ── Front Matter ───────────────────────────────────── -->
      <section>
        <p class="section-title">📝 Share Details</p>
        <div class="field-grid">
          ${SHARE_FIELDS
            .filter((f) => !['checkbox', 'textarea'].includes(f.type))
            .map((f) => {
              if (f.key === 'title') {
                const slugVal  = isNew ? '' : esc(slug || '');
                const slugHint = isNew
                  ? '<small>(auto-generated from Title and Date)</small>'
                  : '<small>(auto-updated from Title and Date — changes on save)</small>';
                const alertMsg = isNew
                  ? 'Post Slug is auto-generated from the Title. To change it, edit the Title above.'
                  : 'Post Slug is auto-updated from the Title and Date. To change it, edit the Title or Date fields above.';
                const slugField = `<div class="span2">
                  <label for="f-post-slug">Post Slug ${slugHint}
                    <input type="text" id="f-post-slug" value="${slugVal}" readonly
                           autocomplete="off"
                           style="background:#f5f5f5;cursor:default"
                     onkeydown="warnSlugReadOnly(event, ${JSON.stringify(alertMsg)})">
                  </label>
                </div>`;
                return `<div class="span2">${renderField(f, d[f.key])}</div>\n          ${slugField}`;
              }
              if (f.fullWidth) {
                return `<div class="span2">${renderField(f, d[f.key])}</div>`;
              }
              return `<div>${renderField(f, d[f.key])}</div>`;
            })
            .join('')}
        </div>
        <div class="check-row" style="margin-top:.5rem">
          ${SHARE_FIELDS
            .filter((f) => f.type === 'checkbox')
            .map((f) => renderField(f, d[f.key]))
            .join('')}
        </div>
      </section>

      <!-- ── Extra Images ──────────────────────────────────── -->
      <section>
        <p class="section-title">📁 Post Images</p>
        <label>Upload additional images
          <small>(stored in <code>images/</code>; use Copy button to insert figure shortcode)</small>
          <input type="file" name="extra_images" accept="image/*" multiple>
        </label>
        ${images.length
          ? `<p style="margin-top:.5rem"><small>${images.length} image(s) uploaded — use the Image Management section below to copy figure shortcode or delete images.</small></p>`
          : ''}
      </section>

      <!-- ── Markdown Content ──────────────────────────────── -->
      <section>
        <p class="section-title">📄 Markdown Content</p>
        <textarea name="content" rows="22">${esc(content)}</textarea>
      </section>

    </form>

    <!-- ── Image Management ──────────────────────────────────-->
    ${(slug && !isNew) ? `
    <section style="margin-top:1.5rem">
      <p class="section-title">🗂️ Image Management</p>
      <div>
         <strong>Images available for this Share</strong>
         ${imgGallery}
       </div>
     </section>` : ''}

    <!-- ── Actions ──────────────────────────────────────── -->
    <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin-top:1.5rem">
      <button type="submit" form="post-form">💾 Save Share</button>
      <button type="button"
              id="btn-preview"
              data-slug="${isNew ? '' : esc(slug)}"
              style="background:#457b9d;border-color:#457b9d;color:#fff"
      >👁 Preview</button>
      ${!isNew
        ? `<a href="/post/${esc(slug)}/preview" target="_blank" style="margin-left:auto">🔗 Preview saved</a>`
        : ''}
    </div>
  `);
}

/** Render the create / edit form for Quotation posts. */
async function quotationFormPage(slug, post, isNew, flash = '') {
  const d       = post?.data    || {};
  const content = post?.content || '';

  // Ensure tags contains 'quotation'
  if (!d.tags) d.tags = ['quotation'];
  else if (!Array.isArray(d.tags)) d.tags = ['quotation'];
  else if (!d.tags.includes('quotation')) d.tags.push('quotation');

  const action = isNew ? '/quotation/create' : `/quotation/${esc(slug)}/update`;
  const pageTitle = isNew ? 'New Quotation' : `Edit Quotation: ${esc(d.title || slug)}`;

  return layout(pageTitle, /* html */ `
    ${flash}
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.5rem">
      <h2 style="margin:0">${pageTitle}</h2>
      ${!isNew ? `<a href="/">← All Posts</a>` : ''}
    </div>

    <form id="post-form" method="POST" action="${action}" enctype="multipart/form-data">
      <!-- Hidden field carries the slug to the preview endpoint -->
      <input type="hidden" name="_slug" value="${isNew ? '' : esc(slug)}">
      <!-- Hidden tags field always contains 'quotation' -->
      <input type="hidden" name="tags" value="quotation">

      <!-- ── Front Matter ───────────────────────────────────── -->
      <section>
        <p class="section-title">📝 Quotation Details</p>
        <div class="field-grid">
          ${QUOTATION_FIELDS
            .filter((f) => !['checkbox', 'textarea', 'attribution'].includes(f.type) && f.key !== 'attribution' && f.key !== 'quotation')
            .map((f) => {
              if (f.key === 'title') {
                const slugVal  = isNew ? '' : esc(slug || '');
                const slugHint = isNew
                  ? '<small>(auto-generated from Title and Date)</small>'
                  : '<small>(auto-updated from Title and Date — changes on save)</small>';
                const alertMsg = isNew
                  ? 'Post Slug is auto-generated from the Title. To change it, edit the Title above.'
                  : 'Post Slug is auto-updated from the Title and Date. To change it, edit the Title or Date fields above.';
                const slugField = `<div class="span2">
                  <label for="f-post-slug">Post Slug ${slugHint}
                    <input type="text" id="f-post-slug" value="${slugVal}" readonly
                           autocomplete="off"
                           style="background:#f5f5f5;cursor:default"
                     onkeydown="warnSlugReadOnly(event, ${JSON.stringify(alertMsg)})">
                  </label>
                </div>`;
                return `<div class="span2">${renderField(f, d[f.key])}</div>\n          ${slugField}`;
              }
              if (f.fullWidth) {
                return `<div class="span2">${renderField(f, d[f.key])}</div>`;
              }
              return `<div>${renderField(f, d[f.key])}</div>`;
            })
            .join('')}
        </div>
        <div class="check-row" style="margin-top:.5rem">
          ${QUOTATION_FIELDS
            .filter((f) => f.type === 'checkbox')
            .map((f) => renderField(f, d[f.key]))
            .join('')}
        </div>
      </section>

      <!-- ── Quotation Textarea ──────────────────────────────── -->
      <section>
        ${QUOTATION_FIELDS
          .filter((f) => f.key === 'quotation')
          .map((f) => renderField(f, d[f.key]))
          .join('')}
      </section>

      <!-- ── Attribution ──────────────────────────────────────── -->
      <section>
        ${QUOTATION_FIELDS
          .filter((f) => f.key === 'attribution')
          .map((f) => renderField(f, d[f.key]))
          .join('')}
      </section>

    </form>

    <!-- ── Actions ──────────────────────────────────────── -->
    <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin-top:1.5rem">
      <button type="submit" form="post-form">💾 Save Quotation</button>
      <button type="button"
              id="btn-preview"
              data-slug="${isNew ? '' : esc(slug)}"
              style="background:#457b9d;border-color:#457b9d;color:#fff"
      >👁 Preview</button>
      ${!isNew
        ? `<a href="/post/${esc(slug)}/preview" target="_blank" style="margin-left:auto">🔗 Preview saved</a>`
        : ''}
    </div>
  `);
}

/** Render the paginated post list. */
function postListPage(posts, page, year = '', tag = '') {
  const filteredByTag = tag
    ? posts.filter((p) => Array.isArray(p.tags) && p.tags.includes(tag))
    : posts;
  const filteredPosts = year
    ? filteredByTag.filter((p) => p.date && String(new Date(p.date).getFullYear()) === year)
    : filteredByTag;

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / PER_PAGE));
  const pageNum    = Math.max(1, Math.min(page, totalPages));
  const start      = (pageNum - 1) * PER_PAGE;
  const pagePosts  = filteredPosts.slice(start, start + PER_PAGE);

  const rows = pagePosts
    .map((p) => {
      const coverCell = p.cover
        ? `<img class="cover-thumb"
                src="${esc(coverUrl(p.slug, p.cover))}"
                alt="${esc(p.cover)}">`
        : `<a href="/post/${esc(p.slug)}/edit" class="cover-placeholder" title="Edit ${esc(p.title)}"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#457b9d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></a>`;

      const dateStr = p.date
        ? new Date(p.date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
          })
        : '—';

      const draftBadge = p.draft ? ' <span class="badge">draft</span>' : '';

      const inlineActions = /* html */`
        <div class="post-inline-actions">
          <a href="/post/${esc(p.slug)}/edit" role="button" class="btn-sm">Edit</a>
          <a href="/post/${esc(p.slug)}/preview" target="_blank"
             role="button" class="btn-sm btn-grey">Preview</a>
          <form method="POST" action="/post/${esc(p.slug)}/delete"
                data-title="${esc(p.title)}"
                onsubmit="return confirmDelete(this)">
            <button type="submit" class="btn-sm btn-red">Delete</button>
          </form>
        </div>`;

      return /* html */ `<tr>
        <td>${coverCell}</td>
        <td>
          <a href="/post/${esc(p.slug)}/edit">${esc(p.title)}</a>${draftBadge}
          <br><small class="col-slug" style="color:#888">${esc(p.slug)}</small>
          ${inlineActions}
        </td>
        <td>${esc(dateStr)}</td>
        <td class="col-writer">${esc(p.writer)}</td>
        <td class="col-actions actions">
          <a href="/post/${esc(p.slug)}/edit" role="button" class="btn-sm">Edit</a>
          <a href="/post/${esc(p.slug)}/preview" target="_blank"
             role="button" class="btn-sm btn-grey">Preview</a>
          <form method="POST" action="/post/${esc(p.slug)}/delete"
                data-title="${esc(p.title)}"
                onsubmit="return confirmDelete(this)">
            <button type="submit" class="btn-sm btn-red">Delete</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  const pageBase   = tag ? `/tag/${encodeURIComponent(tag)}` : '/';
  const pageLinks = Array.from({ length: totalPages }, (_, i) => i + 1)
    .map((i) =>
      i === pageNum
        ? `<span class="active">${i}</span>`
        : `<a href="${pageBase}?page=${i}${year ? `&year=${encodeURIComponent(year)}` : ''}">${i}</a>`,
    )
    .join('');

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from(
    { length: currentYear - EARLIEST_YEAR + 1 },
    (_, i) => String(currentYear - i),
  );
  const yearDropdown = /* html */`
    <form method="get" action="/" style="display:flex;gap:0.4rem;align-items:center;margin:0">
      <select name="year"
              aria-label="Filter by year"
              style="margin:0"
              onchange="this.form.submit()">
        <option value=""${year === '' ? ' selected' : ''}>All years</option>
        ${yearOptions.map((y) =>
          `<option value="${y}"${year === y ? ' selected' : ''}>${y}</option>`,
        ).join('')}
      </select>
     <!-- <button type="submit" class="btn-sm" style="margin:0">Go</button> -->
    </form>`;

  const headerSection = tag
    ? /* html */`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h2 style="margin:0">
        Posts tagged: <em>${esc(tag)}</em>
        <small style="font-weight:400;color:#666">&nbsp;${filteredPosts.length} post${filteredPosts.length !== 1 ? 's' : ''}</small>
      </h2>
      <a href="/" role="button" class="btn-sm">← All posts</a>
    </div>`
    : /* html */`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h2 style="margin:0">
        Posts
        <small style="font-weight:400;color:#666">&nbsp;${filteredPosts.length}${year ? ` in ${esc(year)}` : ' total'}</small>
      </h2>
      <div style="display:flex;gap:0.75rem;align-items:center">
        ${yearDropdown}
        <a href="/post/new" role="button">＋ New Post</a>
        <a href="/share/new" role="button" style="background:#6c757d;border-color:#6c757d">＋ Add Share</a>
        <a href="/quotation/new" role="button" style="background:#6c757d;border-color:#6c757d">＋ Add Quotation</a>
      </div>
    </div>`;

  return layout(tag ? `Posts tagged: ${esc(tag)}` : 'Posts', /* html */ `
    ${headerSection}

    <div id="post-search-wrap" class="search-wrap">
      <input type="search" placeholder="" autocomplete="off" aria-label="Search posts">
      <div class="search-dropdown" role="listbox" aria-label="Search results"></div>
    </div>

    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Cover</th>
            <th>Title</th>
            <th>Date</th>
            <th class="col-writer">Writer</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="pagination">${pageLinks}</div>
  `);
}

/** Serialize a parsed form body as hidden <input> elements for re-submission. */
function hiddenInputsFromBody(body) {
  const skip = new Set(['cover_upload', 'portrait_upload', 'extra_images', 'extra_pdfs']);
  return Object.entries(body)
    .filter(([k]) => !skip.has(k) && !k.startsWith('portrait_upload_') && !k.startsWith('portrait_overwrite_confirmed'))
    .flatMap(([k, v]) => {
      const vals = Array.isArray(v) ? v : [v];
      return vals.map(
        (val) => `<input type="hidden" name="${esc(k)}" value="${esc(String(val ?? ''))}">`,
      );
    })
    .join('\n    ');
}

function decodeShortcodeValue(value) {
  return String(value ?? '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** Render a standalone HTML preview of a post (opened in a new tab). */
function stripPreviewMedia(content = '') {
  return content
    .replace(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi, (_match, inner) =>
      inner
        .replace(/<picture\b[\s\S]*?<\/picture>/gi, '')
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
        .replace(/<source\b[^>]*>/gi, '')
        .trim()
    )
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<source\b[^>]*>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '');
}

function renderPreviewHTML(data, content, slug, { saved = false, rawBody = null } = {}) {
  // Replace all Eleventy shortcodes with plain HTML equivalents

  // {% figure "src", "caption" %} or {% figure "src", "caption", "variant" %}
  const figureRe =
    /\{%-?\s*figure\s+"([^"]+)"\s*,\s*"([^"]*)"\s*(?:,\s*"([^"]*)"\s*)?-?%\}/g;
  let processed = content.replace(figureRe, (_m, src, caption, variant) => {
    const imgSrc = slug
      ? `/post-images/${slug}/${src}`
      : src;
    const cls = variant ? `figure figure--${variant}` : 'figure';
    return `<figure class="${cls}">
  <img src="${imgSrc}" alt="${caption}" style="max-width:100%;height:auto">
  ${caption ? `<figcaption>${caption}</figcaption>` : ''}
</figure>`;
  });

  // {% sizing "fileName", "width", "caption" %}
  const sizingRe =
    /\{%-?\s*sizing\s+"((?:\\.|[^"])*)"\s*,\s*"((?:\\.|[^"])*)"\s*(?:,\s*"((?:\\.|[^"])*)"\s*)?-?%\}/g;
  processed = processed.replace(sizingRe, (_m, fileName, width, caption = '') => {
    const decodedFileName = decodeShortcodeValue(fileName);
    const decodedCaption = decodeShortcodeValue(caption);
    const imgSrc = slug
      ? `/post-images/${slug}/images/${decodedFileName}`
      : decodedFileName;
    const widthValue = Number.parseFloat(decodeShortcodeValue(width).replace(/%/g, ''));
    const safeWidth = Number.isFinite(widthValue) ? widthValue : 100;
    return `<figure class="figure figure--sizing" style="width:${safeWidth}%">
  <img src="${imgSrc}" alt="${decodedCaption || decodedFileName}" style="max-width:100%;height:auto">
  ${decodedCaption ? `<figcaption>${decodedCaption}</figcaption>` : ''}
</figure>`;
  });

  // {% youtube "shareUrl" %}
  const youtubeRe = /\{%-?\s*youtube\s+"([^"]+)"\s*-?%\}/g;
  processed = processed.replace(youtubeRe, (_m, shareUrl) => {
    // Extract video ID from various YouTube URL formats (youtu.be/ID or ?v=ID)
    let videoId;
    try {
      const url = new URL(shareUrl);
      videoId = url.searchParams.get('v') || url.pathname.split('/').pop();
    } catch {
      videoId = shareUrl.split('/').pop().split('?')[0];
    }
    return `<figure class="yt-wrapper">
  <iframe src="https://www.youtube.com/embed/${videoId}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
</figure>`;
  });

  // {% callout "words" %}
  const calloutRe = /\{%-?\s*callout\s+"([^"]*)"\s*-?%\}/g;
  processed = processed.replace(calloutRe, (_m, words) =>
    `<span class="callout">${words}</span>`
  );

  // {% hr %}
  const hrRe = /\{%-?\s*hr\s*-?%\}/g;
  processed = processed.replace(hrRe,
    () => `<div class="hr">&mdash;&diams;&mdash;&mdash;&diams;&mdash;&mdash;&diams;&mdash;</div>`
  );

  const html   = stripPreviewMedia(md.render(processed));
  const title  = esc(data.title || 'Preview');
  const date   = data.date
    ? new Date(data.date).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';
  const writer  = data.writer ? `by ${esc(data.writer)}` : '';
  const artist  = data.artist ? `art by ${esc(data.artist)}` : '';
  const byline  = [date, writer, artist].filter(Boolean).join(' · ');
  const excerpt = data.excerpt ? `<blockquote>${md.renderInline(data.excerpt)}</blockquote>` : '';
  const tags    = data.tags?.length
    ? `<p><small>Tags: ${data.tags.map((t) => `<a href="/tag/${encodeURIComponent(t)}" style="text-decoration:none"><mark>${esc(t)}</mark></a>`).join(' ')}</small></p>`
    : '';
  const coverImg = '';

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} – Preview</title>
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.classless.min.css">
  <style>
    body { max-width:760px; margin:2rem auto; padding:0 1rem 4rem; }
    figure { text-align:center; }
    figure img { max-width:100%; height:auto; }
    figcaption { font-style:italic; color:#666; font-size:.9em; }
    .preview-banner {
      background:#ffe066; padding:4px 10px; border-radius:4px;
      font-size:.8em; font-weight:700; display:inline-block; margin-bottom:1rem;
    }
    mark { background:#e8f0fe; color:#1a237e; border-radius:3px;
           padding:1px 5px; margin-right:3px; }
    a mark { cursor:pointer; }
    a:hover mark { background:#c5d9fc; }
    .preview-toolbar {
      position:sticky; top:0; z-index:100;
      background:rgba(255,255,255,.95); border-bottom:1px solid #ddd;
      padding:.5rem 0; margin-bottom:1.5rem;
      display:flex; align-items:center; gap:.75rem;
    }
    [data-theme="dark"] .preview-toolbar {
      background:rgba(17,24,39,.95); border-bottom-color:#374151;
    }
    .btn-save {
      font-size:.8rem; padding:.3rem .75rem; cursor:pointer;
      background:#2a9d8f; color:#fff; border:none; border-radius:4px;
      text-decoration:none; display:inline-block;
    }
    .btn-save:hover { background:#21867a; }
    .theme-toggle-preview {
      margin-left:auto; background:none; border:1px solid #ddd;
      cursor:pointer; padding:0.4rem 0.8rem; border-radius:4px;
      font-size:0.9em; transition:all 0.2s;
    }
    .theme-toggle-preview:hover { background:#f3f4f6; }
    [data-theme="dark"] .theme-toggle-preview {
      border-color:#4b5563; color:#e5e7eb;
    }
    [data-theme="dark"] .theme-toggle-preview:hover { background:#374151; }
    .hr { text-align:center; padding:1rem 0; }
    .yt-wrapper { max-width:100%; margin:1.5rem auto; text-align:center; }
    .yt-wrapper iframe { width:100%; aspect-ratio:16/9; height:auto; display:block; border:0; }
    .callout { display:block; font-style:italic; width:44%; font-size:2rem; line-height:2rem;
               /* negative margin matches site CSS to pull callout into the right gutter */
               margin-right:-4rem; padding:1.5rem; color:crimson; float:right; }
    @media (max-width:768px) { .callout { width:44%; float:left; margin-right:3rem; } }
  </style>
</head>
<body>
  <script>
    // Theme management for preview page
    (function() {
      const html = document.documentElement;
      const savedTheme = localStorage.getItem('cms-theme') || 'light';
      html.setAttribute('data-theme', savedTheme);
    })();
  </script>
  ${(() => {
    if (saved && slug) {
      return `<div class="preview-toolbar">
    <a href="/" class="btn-save">← Return to Dashboard</a>
    <button class="theme-toggle-preview" onclick="toggleThemePreview()" aria-label="Toggle theme">
      <span id="theme-icon-preview">🌙</span>
    </button>
  </div>
  `;
    }
    if (!saved && rawBody) {
      const action = slug ? `/post/${slug}/update` : '/post/create';
      return `<form method="POST" action="${action}" id="save-form" style="display:none">
    ${hiddenInputsFromBody(rawBody)}
    <input type="hidden" name="_return_to" value="/">
  </form>
  <div class="preview-toolbar">
    <button type="submit" form="save-form" class="btn-save">💾 Save &amp; Return to Dashboard</button>
    <p class="preview-banner" style="margin:0">⚠️ PREVIEW – not yet saved</p>
    <button class="theme-toggle-preview" onclick="toggleThemePreview()" aria-label="Toggle theme">
      <span id="theme-icon-preview">🌙</span>
    </button>
  </div>
  `;
    }
    return '<p class="preview-banner">⚠️ PREVIEW – not yet saved</p>\n  ';
  })()}<article>
    <header>
      ${coverImg}
      <h1>${title}</h1>
      ${byline ? `<p><small>${byline}</small></p>` : ''}
      ${excerpt}
      ${tags}
    </header>
    ${html}
  </article>
  <script>
    // Theme toggle for preview page
    (function() {
      const html = document.documentElement;
      const themeIcon = document.getElementById('theme-icon-preview');
      
      function updateThemeIcon(theme) {
        if (themeIcon) {
          themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
      }
      
      // Initialize with current theme
      const initialTheme = html.getAttribute('data-theme') || 'light';
      updateThemeIcon(initialTheme);
      
      window.toggleThemePreview = function() {
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('cms-theme', newTheme);
        updateThemeIcon(newTheme);
      };
    })();
  </script>
</body>
</html>`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET / – paginated post list
app.get('/', (req, res) => {
  const posts = getAllPosts();
  const page  = Math.max(1, parseInt(req.query.page || '1', 10));
  const yearParam = req.query.year || '';
  const yearNum   = parseInt(yearParam, 10);
  const year      = /^\d{4}$/.test(yearParam) && yearNum >= EARLIEST_YEAR && yearNum <= new Date().getFullYear()
    ? yearParam
    : '';
  let flash = '';
  if (req.query.deleted) flash = '<div class="alert alert-success">✓ Post deleted.</div>';
  if (req.query.saved) flash = '<div class="alert alert-success">✓ Post saved successfully.</div>';
  res.send(postListPage(posts, page, year).replace('<main>', `<main>${flash}`));
});

// GET /tag/:tag – posts filtered by a specific tag
app.get('/tag/:tag', (req, res) => {
  const tag  = req.params.tag?.trim();
  if (!tag) return res.redirect('/');
  const posts = getAllPosts();
  const page  = Math.max(1, parseInt(req.query.page || '1', 10));
  res.send(postListPage(posts, page, '', tag));
});

// GET /post/new – blank create form
app.get('/post/new', async (_req, res) => {
  res.send(await postFormPage(null, null, true));
});

// POST /post/create – save new post
app.post('/post/create', uploadFields, async (req, res) => {
  try {
    const data    = parseBody(req.body);
    const content = req.body.content || '';

    if (!data.title) {
      return res.status(400).send(
        await postFormPage(null, { data, content }, true,
          '<div class="alert alert-error">Title is required.</div>'),
      );
    }

    const slug = makeSlug(data.title, req.body.date || data.date);

    // Handle cover upload
    const coverFile = req.files?.find(f => f.fieldname === 'cover_upload');
    if (coverFile) {
      data.cover = await saveCoverImage(coverFile.path, slug, coverFile.originalname);
    }

    // Handle multiple portrait uploads (portrait_upload_firstname-lastname)
    const portraitFiles = req.files?.filter(f => f.fieldname.startsWith('portrait_upload_')) || [];
    for (const f of portraitFiles) {
      const personSlug = f.fieldname.replace('portrait_upload_', '');
      const overwriteKey = `portrait_overwrite_confirmed_${personSlug}`;
      const portraitFilename = `${personSlug}.webp`;

      // Check if overwrite confirmed
      if (getPostImages(slug).includes(portraitFilename) && req.body[overwriteKey] !== '1') {
        cleanupTmpFiles(req.files);
        return res.status(400).send(
          await postFormPage(null, { data, content }, true,
            '<div class="alert alert-error">Please confirm overwriting the existing portrait before saving.</div>'),
        );
      }

      // Find the person name from the data
      const personName = f.originalname; // We'll derive this from the field
      // Extract person name from writer or artist fields
      const writers = (data.writer || '').split(',').map(w => w.trim()).filter(Boolean);
      const artists = (data.artist || '').split(',').map(a => a.trim()).filter(Boolean);
      const people = [...writers, ...artists];
      const matchedPerson = people.find(p => slugifyPersonName(p) === personSlug);

      if (matchedPerson) {
        const portraitFilename = await savePersonPortraitImage(f.path, slug, matchedPerson);
        data[`portrait-${personSlug}`] = portraitFilename;
      }
    }

    // Handle extra images
    const extraImageFiles = req.files?.filter(f => f.fieldname === 'extra_images') || [];
    for (const f of extraImageFiles) {
      await saveExtraImage(f.path, slug, f.originalname);
    }

    // Handle extra PDFs
    const extraPdfFiles = req.files?.filter(f => f.fieldname === 'extra_pdfs') || [];
    for (const f of extraPdfFiles) {
      await savePdfFile(f.path, slug, f.originalname);
    }

    writePost(slug, data, content);
    const returnTo = req.body._return_to?.trim();
    res.redirect(returnTo === '/' ? '/?saved=1' : `/post/${slug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    cleanupTmpFiles(req.files);
    res.status(500).send(
      await postFormPage(null, { data: parseBody(req.body), content: req.body.content || '' }, true,
        `<div class="alert alert-error">Error: ${esc(err.message)}</div>`),
    );
  }
});

// POST /post/preview – render live preview (no saves; opened in new tab via formaction)
app.post('/post/preview', uploadFields, (req, res) => {
  try {
    const data    = parseBody(req.body);
    const content = req.body.content || '';
    const slug    = req.body._slug?.trim() || null;
    cleanupTmpFiles(req.files); // discard uploads – not needed for preview
    res.send(renderPreviewHTML(data, content, slug, { rawBody: req.body }));
  } catch (err) {
    console.error(err);
    cleanupTmpFiles(req.files);
    res.status(500).send(`<pre>Preview error: ${esc(err.message)}</pre>`);
  }
});

// GET /post/:slug/preview – preview of a saved post
app.get('/post/:slug/preview', (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  const post = readPost(slug);
  if (!post) return res.status(404).send('Post not found');
  res.send(renderPreviewHTML(post.data, post.content, slug, { saved: true }));
});

// GET /post/:slug/edit – edit form
app.get('/post/:slug/edit', async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  const post = readPost(slug);
  if (!post) return res.status(404).send('Post not found');
  const flash = req.query.success
    ? '<div class="alert alert-success">✓ Post saved successfully.</div>'
    : req.query.error === 'notfound'
      ? '<div class="alert alert-error">⚠ Asset file not found — it may have already been deleted.</div>'
      : '';
  if (Array.isArray(post.data.tags) && post.data.tags.includes('share')) {
    return res.send(await shareFormPage(slug, post, false, flash));
  }
  if (Array.isArray(post.data.tags) && post.data.tags.includes('quotation')) {
    return res.send(await quotationFormPage(slug, post, false, flash));
  }
  res.send(await postFormPage(slug, post, false, flash));
});

// POST /post/:slug/update – save edited post
app.post('/post/:slug/update', uploadFields, async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');

  try {
    const data    = parseBody(req.body);
    const content = req.body.content || '';

    // Compute and validate the new slug before touching the filesystem
    const newSlug = makeSlug(data.title, req.body.date || data.date);
    if (!validSlug(newSlug)) {
      cleanupTmpFiles(req.files);
      return res.status(400).send(
        await postFormPage(slug, readPost(slug), false,
          '<div class="alert alert-error">Title is required and must produce a valid slug.</div>'),
      );
    }
    if (newSlug !== slug) {
      const newDir = path.join(POSTS_DIR, newSlug);
      if (fs.existsSync(newDir)) {
        cleanupTmpFiles(req.files);
        return res.status(400).send(
          await postFormPage(slug, readPost(slug), false,
            `<div class="alert alert-error">Cannot rename: a post with slug <strong>${esc(newSlug)}</strong> already exists.</div>`),
        );
      }
    }

    // Handle cover upload
    const coverFile = req.files?.find(f => f.fieldname === 'cover_upload');
    if (coverFile) {
      data.cover = await saveCoverImage(coverFile.path, slug, coverFile.originalname);
    }

    // Handle multiple portrait uploads (portrait_upload_firstname-lastname)
    const portraitFiles = req.files?.filter(f => f.fieldname.startsWith('portrait_upload_')) || [];
    for (const f of portraitFiles) {
      const personSlug = f.fieldname.replace('portrait_upload_', '');
      const overwriteKey = `portrait_overwrite_confirmed_${personSlug}`;
      const portraitFilename = `${personSlug}.webp`;

      // Check if overwrite confirmed
      if (getPostImages(slug).includes(portraitFilename) && req.body[overwriteKey] !== '1') {
        cleanupTmpFiles(req.files);
        return res.status(400).send(
          await postFormPage(slug, { data, content }, false,
            '<div class="alert alert-error">Please confirm overwriting the existing portrait before saving.</div>'),
        );
      }

      // Extract person name from writer or artist fields
      const writers = (data.writer || '').split(',').map(w => w.trim()).filter(Boolean);
      const artists = (data.artist || '').split(',').map(a => a.trim()).filter(Boolean);
      const people = [...writers, ...artists];
      const matchedPerson = people.find(p => slugifyPersonName(p) === personSlug);

      if (matchedPerson) {
        const portraitFilename = await savePersonPortraitImage(f.path, slug, matchedPerson);
        data[`portrait-${personSlug}`] = portraitFilename;
      }
    }

    // Handle extra images
    const extraImageFiles = req.files?.filter(f => f.fieldname === 'extra_images') || [];
    for (const f of extraImageFiles) {
      await saveExtraImage(f.path, slug, f.originalname);
    }

    // Handle extra PDFs
    const extraPdfFiles = req.files?.filter(f => f.fieldname === 'extra_pdfs') || [];
    for (const f of extraPdfFiles) {
      await savePdfFile(f.path, slug, f.originalname);
    }

    if (newSlug !== slug) {
      const oldDir = path.join(POSTS_DIR, slug);
      const newDir = path.join(POSTS_DIR, newSlug);
      try {
        await fs.promises.rename(oldDir, newDir);
      } catch (renameErr) {
        if (renameErr.code === 'EEXIST' || renameErr.code === 'ENOTEMPTY') {
          // Race condition: another post grabbed the slug between our check and rename
          return res.status(400).send(
            await postFormPage(slug, readPost(slug), false,
              `<div class="alert alert-error">Cannot rename: a post with slug <strong>${esc(newSlug)}</strong> already exists.</div>`),
          );
        }
        if (renameErr.code === 'EXDEV') {
          // Cross-filesystem move: copy then delete
          await fs.promises.cp(oldDir, newDir, { recursive: true });
          await fs.promises.rm(oldDir, { recursive: true, force: true });
        } else {
          throw renameErr;
        }
      }
    }

    writePost(newSlug, data, content);
    const returnTo = req.body._return_to?.trim();
    res.redirect(returnTo === '/' ? '/?saved=1' : `/post/${newSlug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    cleanupTmpFiles(req.files);
    const post = readPost(slug);
    res.status(500).send(
      await postFormPage(slug, post, false,
        `<div class="alert alert-error">Error: ${esc(err.message)}</div>`),
    );
  }
});

// POST /post/:slug/delete – delete post
app.post('/post/:slug/delete', (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  deletePost(slug);
  res.redirect('/?deleted=1');
});

// ─── Share Routes ─────────────────────────────────────────────────────────────

// GET /share/new – blank Share create form
app.get('/share/new', async (_req, res) => {
  res.send(await shareFormPage(null, null, true));
});

// POST /share/create – save new Share
app.post('/share/create', uploadFields, async (req, res) => {
  try {
    const data    = parseBody(req.body, SHARE_FIELDS);
    const content = req.body.content || '';

    // Ensure tags contains 'share'
    data.tags = ['share'];

    if (!data.title) {
      return res.status(400).send(
        await shareFormPage(null, { data, content }, true,
          '<div class="alert alert-error">Title is required.</div>'),
      );
    }

    const slug = makeSlug(data.title, req.body.date || data.date);
    
    for (const f of req.files?.extra_images || []) {
      await saveExtraImage(f.path, slug, f.originalname);
    }

    writePost(slug, data, content);
    const returnTo = req.body._return_to?.trim();
    res.redirect(returnTo === '/' ? '/?saved=1' : `/share/${slug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    cleanupTmpFiles(req.files);
    res.status(500).send(
      await shareFormPage(null, { data: parseBody(req.body, SHARE_FIELDS), content: req.body.content || '' }, true,
        `<div class="alert alert-error">Error: ${esc(err.message)}</div>`),
    );
  }
});

// GET /share/:slug/edit – edit form for Share
app.get('/share/:slug/edit', async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  const post = readPost(slug);
  if (!post) return res.status(404).send('Post not found');
  const flash = req.query.success
    ? '<div class="alert alert-success">✓ Share saved successfully.</div>'
    : req.query.error === 'notfound'
      ? '<div class="alert alert-error">⚠ Asset file not found — it may have already been deleted.</div>'
      : '';
  res.send(await shareFormPage(slug, post, false, flash));
});

// POST /share/:slug/update – save edited Share
app.post('/share/:slug/update', uploadFields, async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');

  try {
    const data    = parseBody(req.body, SHARE_FIELDS);
    const content = req.body.content || '';

    // Ensure tags contains 'share'
    data.tags = ['share'];

    // Compute and validate the new slug before touching the filesystem
    const newSlug = makeSlug(data.title, req.body.date || data.date);
    if (!validSlug(newSlug)) {
      cleanupTmpFiles(req.files);
      return res.status(400).send(
        await shareFormPage(slug, readPost(slug), false,
          '<div class="alert alert-error">Title is required and must produce a valid slug.</div>'),
      );
    }
    if (newSlug !== slug) {
      const newDir = path.join(POSTS_DIR, newSlug);
      if (fs.existsSync(newDir)) {
        cleanupTmpFiles(req.files);
        return res.status(400).send(
          await shareFormPage(slug, readPost(slug), false,
            `<div class="alert alert-error">Cannot rename: a post with slug <strong>${esc(newSlug)}</strong> already exists.</div>`),
        );
      }
    }

    // Save uploaded images to the current (old) directory, then rename if needed
    for (const f of req.files?.extra_images || []) {
      await saveExtraImage(f.path, slug, f.originalname);
    }

    if (newSlug !== slug) {
      const oldDir = path.join(POSTS_DIR, slug);
      const newDir = path.join(POSTS_DIR, newSlug);
      try {
        await fs.promises.rename(oldDir, newDir);
      } catch (renameErr) {
        if (renameErr.code === 'EEXIST' || renameErr.code === 'ENOTEMPTY') {
          return res.status(400).send(
            await shareFormPage(slug, readPost(slug), false,
              `<div class="alert alert-error">Cannot rename: a post with slug <strong>${esc(newSlug)}</strong> already exists.</div>`),
          );
        }
        if (renameErr.code === 'EXDEV') {
          // Cross-filesystem move: copy then delete
          await fs.promises.cp(oldDir, newDir, { recursive: true });
          await fs.promises.rm(oldDir, { recursive: true, force: true });
        } else {
          throw renameErr;
        }
      }
    }

    writePost(newSlug, data, content);
    const returnTo = req.body._return_to?.trim();
    res.redirect(returnTo === '/' ? '/?saved=1' : `/share/${newSlug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    cleanupTmpFiles(req.files);
    const post = readPost(slug);
    res.status(500).send(
      await shareFormPage(slug, post, false,
        `<div class="alert alert-error">Error: ${esc(err.message)}</div>`),
    );
  }
});

// POST /share/:slug/delete – delete Share
app.post('/share/:slug/delete', (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  deletePost(slug);
  res.redirect('/?deleted=1');
});

// POST /share/:slug/image-delete – move a Share image to system trash
app.post('/share/:slug/image-delete', async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  const filename = req.body.filename?.trim();
  const type     = req.body.type?.trim();
  if (!filename) return res.status(400).send('No filename provided');
  try {
    const targetPath = type === 'image'
      ? path.join(POSTS_DIR, slug, 'images', filename)
      : path.join(POSTS_DIR, slug, 'files', filename);
    if (!fs.existsSync(targetPath)) {
      return res.redirect(`/share/${slug}/edit?error=notfound`);
    }
    await trash(targetPath);
    res.redirect(`/share/${slug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error deleting asset: ${esc(err.message)}`);
  }
});

// ─── Quotation Routes ─────────────────────────────────────────────────────────

// GET /quotation/new – blank Quotation create form
app.get('/quotation/new', async (_req, res) => {
  res.send(await quotationFormPage(null, null, true));
});

// POST /quotation/create – save new Quotation
app.post('/quotation/create', uploadFields, async (req, res) => {
  try {
    const data    = parseBody(req.body, QUOTATION_FIELDS);
    const content = req.body.content || '';

    // Ensure tags contains 'quotation'
    data.tags = ['quotation'];

    if (!data.title) {
      return res.status(400).send(
        await quotationFormPage(null, { data, content }, true,
          '<div class="alert alert-error">Title is required.</div>'),
      );
    }

    const slug = makeSlug(data.title, req.body.date || data.date);

    writePost(slug, data, content);
    const returnTo = req.body._return_to?.trim();
    res.redirect(returnTo === '/' ? '/?saved=1' : `/quotation/${slug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    cleanupTmpFiles(req.files);
    res.status(500).send(
      await quotationFormPage(null, { data: parseBody(req.body, QUOTATION_FIELDS), content: req.body.content || '' }, true,
        `<div class="alert alert-error">Error: ${esc(err.message)}</div>`),
    );
  }
});

// GET /quotation/:slug/edit – edit form for Quotation
app.get('/quotation/:slug/edit', async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  const post = readPost(slug);
  if (!post) return res.status(404).send('Post not found');
  const flash = req.query.success
    ? '<div class="alert alert-success">✓ Quotation saved successfully.</div>'
    : '';
  res.send(await quotationFormPage(slug, post, false, flash));
});

// POST /quotation/:slug/update – save edited Quotation
app.post('/quotation/:slug/update', uploadFields, async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');

  try {
    const data    = parseBody(req.body, QUOTATION_FIELDS);
    const content = req.body.content || '';

    // Ensure tags contains 'quotation'
    data.tags = ['quotation'];

    // Compute and validate the new slug before touching the filesystem
    const newSlug = makeSlug(data.title, req.body.date || data.date);
    if (!validSlug(newSlug)) {
      cleanupTmpFiles(req.files);
      return res.status(400).send(
        await quotationFormPage(slug, readPost(slug), false,
          '<div class="alert alert-error">Title is required and must produce a valid slug.</div>'),
      );
    }
    if (newSlug !== slug) {
      const newDir = path.join(POSTS_DIR, newSlug);
      if (fs.existsSync(newDir)) {
        cleanupTmpFiles(req.files);
        return res.status(400).send(
          await quotationFormPage(slug, readPost(slug), false,
            `<div class="alert alert-error">Cannot rename: a post with slug <strong>${esc(newSlug)}</strong> already exists.</div>`),
        );
      }
    }

    if (newSlug !== slug) {
      const oldDir = path.join(POSTS_DIR, slug);
      const newDir = path.join(POSTS_DIR, newSlug);
      try {
        await fs.promises.rename(oldDir, newDir);
      } catch (renameErr) {
        if (renameErr.code === 'EEXIST' || renameErr.code === 'ENOTEMPTY') {
          return res.status(400).send(
            await quotationFormPage(slug, readPost(slug), false,
              `<div class="alert alert-error">Cannot rename: a post with slug <strong>${esc(newSlug)}</strong> already exists.</div>`),
          );
        }
        if (renameErr.code === 'EXDEV') {
          // Cross-filesystem move: copy then delete
          await fs.promises.cp(oldDir, newDir, { recursive: true });
          await fs.promises.rm(oldDir, { recursive: true, force: true });
        } else {
          throw renameErr;
        }
      }
    }

    writePost(newSlug, data, content);
    const returnTo = req.body._return_to?.trim();
    res.redirect(returnTo === '/' ? '/?saved=1' : `/quotation/${newSlug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    cleanupTmpFiles(req.files);
    const post = readPost(slug);
    res.status(500).send(
      await quotationFormPage(slug, post, false,
        `<div class="alert alert-error">Error: ${esc(err.message)}</div>`),
    );
  }
});

// POST /quotation/:slug/delete – delete Quotation
app.post('/quotation/:slug/delete', (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');
  deletePost(slug);
  res.redirect('/?deleted=1');
});

// POST /post/:slug/image-delete – move a post image to system trash
app.post('/post/:slug/image-delete', async (req, res) => {
  const { slug } = req.params;
  if (!validSlug(slug)) return res.status(400).send('Invalid slug');

  const filename = (req.body.filename || '').trim();
  const type     = req.body.type || 'image'; // 'cover' | 'image' | 'file'

  // Validate filename: no path separators, no traversal
  if (!filename || /[/\\]/.test(filename)) {
    return res.status(400).send('Invalid filename');
  }

  // Covers now live in the post's own images/ directory.
  // Legacy covers stored in COVERS_DIR are also supported as a fallback.
  let baseDir  = type === 'file'
    ? path.resolve(POSTS_DIR, slug, 'files')
    : path.resolve(POSTS_DIR, slug, 'images');
  let filePath = path.resolve(baseDir, filename);

  // Ensure the resolved path stays within baseDir (path.relative returns '..' for escapes)
  const rel = path.relative(baseDir, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return res.status(400).send('Invalid filename');
  }

  // Fall back to legacy COVERS_DIR for covers uploaded before this change.
  if (type === 'cover' && !fs.existsSync(filePath)) {
    const legacyDir  = COVERS_DIR;
    const legacyPath = path.resolve(legacyDir, filename);
    const legacyRel  = path.relative(legacyDir, legacyPath);
    if (!legacyRel || legacyRel.startsWith('..') || path.isAbsolute(legacyRel)) {
      return res.status(400).send('Invalid filename');
    }
    baseDir  = legacyDir;
    filePath = legacyPath;
  }

  if (!fs.existsSync(filePath)) {
    return res.redirect(`/post/${slug}/edit?error=notfound`);
  }

  try {
    await trash(filePath);

    // If deleting the cover, clear the cover field in front matter
    if (type === 'cover') {
      const post = readPost(slug);
      if (post) {
        delete post.data.cover;
        writePost(slug, post.data, post.content);
      }
    }

    res.redirect(`/post/${slug}/edit?success=1`);
  } catch (err) {
    console.error(err);
    res.status(500).send(
      layout('Error', `<h2>Could not delete image</h2><pre>${esc(err.message)}</pre><a href="/post/${esc(slug)}/edit">← Back</a>`),
    );
  }
});

// GET /api/search – typeahead search by title or writer
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const results = getAllPosts()
    .filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.writer && p.writer.toLowerCase().includes(q)),
    )
    .slice(0, 20)
    .map((p) => ({ slug: p.slug, title: p.title, writer: p.writer, draft: p.draft }));
  res.json(results);
});

// GET /api/eleventy-status – probe whether the Eleventy local dev server is running
app.get('/api/eleventy-status', (_req, res) => {
  const probe = http.get('http://localhost:8080', { timeout: 1500 }, (r) => {
    r.resume(); // discard response body
    res.json({ running: true });
  });
  probe.on('error', () => { if (!res.headersSent) res.json({ running: false }); });
  probe.on('timeout', () => {
    probe.destroy();
    if (!res.headersSent) res.json({ running: false });
  });
});

// ─── Error / 404 ──────────────────────────────────────────────────────────────

app.use((_req, res) =>
  res
    .status(404)
    .send(layout('Not Found', '<h2>Page not found</h2><a href="/">← Back to list</a>')),
);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res
    .status(500)
    .send(layout('Error', `<h2>Server Error</h2><pre>${esc(err.message)}</pre><a href="/">← Back</a>`));
});

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Delete any leftover tmp files from a multer upload. */
function cleanupTmpFiles(files) {
  if (!files) return;
  for (const list of Object.values(files)) {
    for (const f of list) {
      try { fs.rmSync(f.path, { force: true }); } catch { /* ignore */ }
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  📚  aplus CMS                           ║
║  http://localhost:${PORT}                    ║
║  Posts dir: ${path.relative(process.cwd(), POSTS_DIR)}  ║
║  Ctrl+C to stop                          ║
╚══════════════════════════════════════════╝
`);
});
