/**
 * Fetch Writer Photos Script
 * 
 * This script scans markdown files in /content/posts, extracts writer names from YAML front matter,
 * fetches their Wikipedia photos, resizes them to 240px wide, converts to WebP format,
 * saves them to the post's images directory, and adds a 'portrait' field to the front matter.
 * 
 * Usage: node scripts/fetch-writer-photos.js
 * 
 * Options:
 *   --dry-run: Preview what would be done without making changes
 *   --limit=N: Only process N posts (useful for testing)
 */

import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const POSTS_DIR = path.join(__dirname, '../content/posts');
const TARGET_WIDTH = 240;
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1];

// User-Agent for Wikipedia API requests (required by Wikipedia)
const USER_AGENT = 'WriterPhotoFetcher/1.0 (https://github.com/midlevels/simple)';

/**
 * Extract YAML front matter from markdown content
 */
function extractFrontMatter(content) {
  const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontMatterRegex);
  
  if (!match) return null;
  
  const frontMatter = {};
  const lines = match[1].split('\n');
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      frontMatter[key] = value;
    }
  }
  
  return frontMatter;
}

/**
 * Update YAML front matter in markdown content
 */
function updateFrontMatter(content, key, value) {
  const frontMatterRegex = /^(---\n)([\s\S]*?)(\n---)/;
  const match = content.match(frontMatterRegex);
  
  if (!match) return content;
  
  const [fullMatch, startDelim, frontMatterBody, endDelim] = match;
  
  // Check if the key already exists
  const lines = frontMatterBody.split('\n');
  let keyExists = false;
  const updatedLines = lines.map(line => {
    if (line.trim().startsWith(key + ':')) {
      keyExists = true;
      return `${key}: ${value}`;
    }
    return line;
  });
  
  // If key doesn't exist, add it after the writer field (or at the end)
  if (!keyExists) {
    const writerIndex = updatedLines.findIndex(line => line.trim().startsWith('writer:'));
    if (writerIndex >= 0) {
      updatedLines.splice(writerIndex + 1, 0, `${key}: ${value}`);
    } else {
      updatedLines.push(`${key}: ${value}`);
    }
  }
  
  const newFrontMatter = startDelim + updatedLines.join('\n') + endDelim;
  return content.replace(frontMatterRegex, newFrontMatter);
}

/**
 * Make an HTTPS request with proper headers
 */
function httpsRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    };
    
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Search Wikipedia for a person and get their main image
 */
async function fetchWikipediaImage(writerName) {
  try {
    // First, search for the page
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(writerName)}&format=json`;
    
    const searchData = await httpsRequest(searchUrl);
    const searchResult = JSON.parse(searchData);
    
    if (!searchResult.query?.search?.length) {
      console.log(`  ⚠️  No Wikipedia page found for: ${writerName}`);
      return null;
    }
    
    const pageTitle = searchResult.query.search[0].title;
    console.log(`  ✓ Found Wikipedia page: ${pageTitle}`);
    
    // Now get the page image
    const imageUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=1000`;
    
    const imageData = await httpsRequest(imageUrl);
    const imageResult = JSON.parse(imageData);
    const pages = imageResult.query?.pages;
    
    if (!pages) {
      console.log(`  ⚠️  No image data for: ${writerName}`);
      return null;
    }
    
    const pageId = Object.keys(pages)[0];
    const thumbnailUrl = pages[pageId]?.thumbnail?.source;
    
    if (!thumbnailUrl) {
      console.log(`  ⚠️  No image found for: ${writerName}`);
      return null;
    }
    
    console.log(`  ✓ Found image URL`);
    return { url: thumbnailUrl, pageTitle };
    
  } catch (err) {
    console.error(`  ❌ Error fetching Wikipedia data for ${writerName}:`, err.message);
    return null;
  }
}

/**
 * Download an image from a URL
 */
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': USER_AGENT
      }
    };
    
    https.get(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Resize image to target width and convert to WebP
 */
async function resizeAndConvertImage(imageBuffer, targetWidth) {
  return sharp(imageBuffer)
    .resize(targetWidth, null, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 85 })
    .toBuffer();
}

/**
 * Generate filename from writer name
 * 
 * IMPORTANT: This function must match the slugifyPersonName() function in cms/server.js
 * to ensure the CMS can recognize portrait files created by this script.
 * 
 * The normalization logic is intentionally duplicated (not extracted to a shared utility)
 * because this script is standalone and should remain independent of the CMS codebase.
 * 
 * Normalization steps:
 * 1. Normalize to NFKD (decompose characters with diacritics)
 * 2. Remove diacritic marks (U+0300 to U+036F)
 * 3. Convert to lowercase
 * 4. Replace non-alphanumeric sequences with dashes
 * 5. Remove leading/trailing dashes
 * 6. Append .webp extension
 * 
 * Examples:
 * - "José García" → "jose-garcia.webp"
 * - "François Müller" → "francois-muller.webp"
 */
function generateFilename(writerName) {
  return writerName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') + '.webp';
}

/**
 * Generate legacy filename (without diacritic normalization)
 * Used to detect files created before the diacritic handling fix
 */
function generateLegacyFilename(writerName) {
  return writerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') + '.webp';
}

/**
 * Find existing portrait file, trying both normalized and legacy filenames
 */
async function findExistingPortrait(imagesDir, writerName) {
  const normalizedFilename = generateFilename(writerName);
  const normalizedPath = path.join(imagesDir, normalizedFilename);
  
  try {
    await fs.access(normalizedPath);
    return { filename: normalizedFilename, path: normalizedPath, isLegacy: false };
  } catch {
    // Try legacy filename
    const legacyFilename = generateLegacyFilename(writerName);
    if (legacyFilename !== normalizedFilename) {
      const legacyPath = path.join(imagesDir, legacyFilename);
      try {
        await fs.access(legacyPath);
        return { filename: legacyFilename, path: legacyPath, isLegacy: true };
      } catch {
        // Neither exists
      }
    }
  }
  
  return null;
}

/**
 * Process a single post directory
 */
async function processPost(postDir) {
  const indexPath = path.join(postDir, 'index.md');
  
  try {
    // Check if index.md exists
    await fs.access(indexPath);
  } catch {
    return null; // No index.md, skip this directory
  }
  
  const content = await fs.readFile(indexPath, 'utf-8');
  const frontMatter = extractFrontMatter(content);
  
  if (!frontMatter?.writer) {
    return null; // No writer field, skip
  }
  
  const writerName = frontMatter.writer;
  console.log(`\n📖 Processing: ${path.basename(postDir)}`);
  console.log(`  Writer: ${writerName}`);
  
  // Check if portrait field already exists
  if (frontMatter.portrait) {
    console.log(`  ℹ️  Portrait field already exists: ${frontMatter.portrait}`);
    return { skipped: true, writer: writerName, reason: 'portrait field exists' };
  }
  
  // Check if image already exists (try both normalized and legacy filenames)
  const imagesDir = path.join(postDir, 'images');
  const existingPortrait = await findExistingPortrait(imagesDir, writerName);
  const expectedFilename = generateFilename(writerName);
  const targetPath = path.join(imagesDir, expectedFilename);
  
  if (existingPortrait) {
    if (existingPortrait.isLegacy) {
      console.log(`  ⚠️  Found legacy portrait with non-normalized name: ${existingPortrait.filename}`);
      console.log(`  🔄 Renaming to normalized filename: ${expectedFilename}`);
      
      if (!DRY_RUN) {
        // Rename the legacy file to the new normalized name
        await fs.rename(existingPortrait.path, targetPath);
        console.log(`  ✅ Renamed portrait to: ${expectedFilename}`);
        
        // Update front matter with the new filename
        const updatedContent = updateFrontMatter(content, 'portrait', expectedFilename);
        await fs.writeFile(indexPath, updatedContent, 'utf-8');
        console.log(`  ✅ Updated front matter with portrait: ${expectedFilename}`);
      } else {
        console.log(`  🔍 [DRY RUN] Would rename to: ${expectedFilename}`);
        console.log(`  🔍 [DRY RUN] Would add 'portrait: ${expectedFilename}' to front matter`);
      }
      
      return { skipped: true, writer: writerName, reason: 'legacy image renamed' };
    } else {
      console.log(`  ℹ️  Photo already exists: ${expectedFilename}`);
      
      // Update front matter even if image exists
      if (!DRY_RUN) {
        const updatedContent = updateFrontMatter(content, 'portrait', expectedFilename);
        await fs.writeFile(indexPath, updatedContent, 'utf-8');
        console.log(`  ✅ Updated front matter with portrait: ${expectedFilename}`);
      }
      
      return { skipped: true, writer: writerName, reason: 'image exists, added to front matter' };
    }
  }
  
  if (DRY_RUN) {
    console.log(`  🔍 [DRY RUN] Would fetch image for: ${writerName}`);
    console.log(`  🔍 [DRY RUN] Would save as: ${expectedFilename}`);
    console.log(`  🔍 [DRY RUN] Would add 'portrait: ${expectedFilename}' to front matter`);
    return { dryRun: true, writer: writerName };
  }
  
  // Fetch Wikipedia image
  const imageInfo = await fetchWikipediaImage(writerName);
  
  if (!imageInfo) {
    return { error: true, writer: writerName };
  }
  
  // Download the image
  console.log(`  ⬇️  Downloading image...`);
  const imageBuffer = await downloadImage(imageInfo.url);
  
  // Resize and convert to WebP
  console.log(`  🔧 Resizing to ${TARGET_WIDTH}px wide and converting to WebP...`);
  const resizedBuffer = await resizeAndConvertImage(imageBuffer, TARGET_WIDTH);
  
  // Ensure images directory exists
  try {
    await fs.mkdir(imagesDir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }
  
  // Save the image
  await fs.writeFile(targetPath, resizedBuffer);
  console.log(`  ✅ Saved: images/${expectedFilename}`);
  
  // Update the markdown file with portrait field
  const updatedContent = updateFrontMatter(content, 'portrait', expectedFilename);
  await fs.writeFile(indexPath, updatedContent, 'utf-8');
  console.log(`  ✅ Updated front matter with portrait: ${expectedFilename}`);
  
  return {
    success: true,
    writer: writerName,
    filename: expectedFilename,
    path: targetPath
  };
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting Writer Photo Fetcher\n');
  console.log(`Target width: ${TARGET_WIDTH}px`);
  console.log(`Format: WebP`);
  console.log(`Dry run: ${DRY_RUN ? 'YES' : 'NO'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} posts`);
  console.log('─'.repeat(50));
  
  // Get all post directories
  const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true });
  const postDirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(POSTS_DIR, entry.name));
  
  console.log(`\nFound ${postDirs.length} post directories`);
  
  // Process posts
  const results = {
    success: [],
    skipped: [],
    errors: [],
    dryRun: []
  };
  
  const postsToProcess = LIMIT ? postDirs.slice(0, parseInt(LIMIT)) : postDirs;
  
  for (const postDir of postsToProcess) {
    try {
      const result = await processPost(postDir);
      
      if (result?.success) results.success.push(result);
      else if (result?.skipped) results.skipped.push(result);
      else if (result?.error) results.errors.push(result);
      else if (result?.dryRun) results.dryRun.push(result);
      
      // Small delay to be nice to Wikipedia API
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (err) {
      console.error(`\n❌ Error processing ${path.basename(postDir)}:`, err.message);
      results.errors.push({ writer: 'unknown', error: err.message });
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(50));
  console.log(`✅ Successfully processed: ${results.success.length}`);
  console.log(`⏭️  Skipped (already exist): ${results.skipped.length}`);
  console.log(`❌ Errors: ${results.errors.length}`);
  if (DRY_RUN) console.log(`🔍 Dry run items: ${results.dryRun.length}`);
  
  if (results.errors.length > 0) {
    console.log('\n⚠️  Writers with errors:');
    results.errors.forEach(r => console.log(`   - ${r.writer}`));
  }
  
  if (DRY_RUN && results.dryRun.length > 0) {
    console.log('\n🔍 Would process these writers:');
    results.dryRun.forEach(r => console.log(`   - ${r.writer}`));
  }
  
  console.log('\n✨ Done!\n');
}

// Run the script
main().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
