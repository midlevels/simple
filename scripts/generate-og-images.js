/**
 * Standalone OG image generation script.
 * Mirrors the eleventy.before hook in eleventy.config.js.
 *
 * Usage:
 *   node scripts/generate-og-images.js          # skip posts that already have og-image.webp
 *   node scripts/generate-og-images.js --force  # regenerate og-image.webp for all posts
 */

import { readdirSync, existsSync, unlinkSync, statSync } from 'fs';
import { join, resolve } from 'path';
import sharp from 'sharp';

const OG_WIDTH  = 600;
const OG_HEIGHT = 315;
const OG_OUTPUT = 'og-image.webp';
const OG_LEGACY = 'og.svg';

const force    = process.argv.includes('--force');
const postsDir = resolve('content/posts');

if (!existsSync(postsDir)) {
    console.error(`Posts directory not found: ${postsDir}`);
    process.exit(1);
}

const postDirs = readdirSync(postsDir)
    .map((name) => join(postsDir, name))
    .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });

let generated = 0;
let skipped   = 0;

for (const postDir of postDirs) {
    const imagesDir  = join(postDir, 'images');
    if (!existsSync(imagesDir)) continue;

    const outputFile = join(imagesDir, OG_OUTPUT);

    if (existsSync(outputFile) && !force) {
        skipped++;
        continue;
    }

    // Find candidate source images (any .webp that is not the output or a thumb)
    const candidates = readdirSync(imagesDir).filter(
        (f) => f.endsWith('.webp') && f !== OG_OUTPUT && !f.endsWith('-thumb.webp'),
    );
    if (candidates.length === 0) continue;

    // Shuffle and pick the first image that is >= OG_WIDTH px wide
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    let sourceFile  = null;
    for (const file of shuffled) {
        try {
            const meta = await sharp(join(imagesDir, file)).metadata();
            if (meta.width && meta.width >= OG_WIDTH) {
                sourceFile = join(imagesDir, file);
                break;
            }
        } catch { /* skip unreadable files */ }
    }
    if (!sourceFile) continue;

    await sharp(sourceFile)
        .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toFile(outputFile);

    console.log(`Generated: ${outputFile}`);
    generated++;

    // Remove legacy og.svg if present
    const legacyFile = join(imagesDir, OG_LEGACY);
    if (existsSync(legacyFile)) {
        unlinkSync(legacyFile);
        console.log(`Removed legacy: ${legacyFile}`);
    }
}

console.log(`Done — generated: ${generated}, skipped: ${skipped}`);
