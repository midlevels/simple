// .eleventy.config.js
import {
    IdAttributePlugin,
    InputPathToUrlTransformPlugin,
    HtmlBasePlugin
} from "@11ty/eleventy";

import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import markdownIt from "markdown-it";
import markdownItLinkAttributes from "markdown-it-link-attributes";
import footnote_plugin from "markdown-it-footnote";
import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
import pluginNavigation from "@11ty/eleventy-navigation";
import { DateTime } from 'luxon';
import { readdirSync, readFileSync, existsSync, unlinkSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import widont from "widont";

function toArray(value) {
    if (!value) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

function hasExcludedPostTags(item) {
    return toArray(item.data?.tags).some(tag => tag === "extlink" || tag === "share");
}

function getItemWriters(item) {
    if (hasExcludedPostTags(item)) {
        return [];
    }

    const writers = toArray(item.data?.writer);
    // Split comma-separated writers and trim whitespace
    return writers.flatMap(w =>
        typeof w === 'string' ? w.split(',').map(name => name.trim()).filter(Boolean) : []
    );
}

function getItemArtists(item) {
    if (hasExcludedPostTags(item)) {
        return [];
    }

    const artists = toArray(item.data?.artist);
    // Split comma-separated artists and trim whitespace
    return artists.flatMap(a =>
        typeof a === 'string' ? a.split(',').map(name => name.trim()).filter(Boolean) : []
    );
}

function getAllWriters(collection = []) {
    const writerSet = new Set();

    collection.forEach(item => {
        getItemWriters(item).forEach(writer => writerSet.add(writer));
    });

    return [...writerSet].sort((a, b) => a.localeCompare(b));
}

function getAllArtists(collection = []) {
    const artistSet = new Set();

    collection.forEach(item => {
        getItemArtists(item).forEach(artist => artistSet.add(artist));
    });

    return [...artistSet].sort((a, b) => a.localeCompare(b));
}

export default async function (eleventyConfig) {

    // OG Image Generation: auto-generate og-image.webp for new posts before build
    eleventyConfig.on("eleventy.before", async ({ inputDir, outputDir }) => {
        // Ensure /_site/img/covers/ always exists so cover <img> references never 404.
        const coversOutDir = join(outputDir || "_site", "img", "covers");
        mkdirSync(coversOutDir, { recursive: true });

        const OG_WIDTH = 600;
        const OG_HEIGHT = 315;
        const OG_OUTPUT = "og-image.webp";
        const OG_LEGACY = "og.svg";
        const postsDir = join(inputDir, "posts");

        if (!existsSync(postsDir)) return;

        const postDirs = readdirSync(postsDir)
            .map((name) => join(postsDir, name))
            .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });

        for (const postDir of postDirs) {
            const imagesDir = join(postDir, "images");
            if (!existsSync(imagesDir)) continue;

            const outputFile = join(imagesDir, OG_OUTPUT);
            if (existsSync(outputFile)) continue;

            // Find candidate source images
            const candidates = readdirSync(imagesDir).filter((f) =>
                f.endsWith(".webp") && f !== OG_OUTPUT && !f.endsWith("-thumb.webp")
            );
            if (candidates.length === 0) continue;

            // Shuffle and pick first image that is >= 600px wide
            const shuffled = [...candidates].sort(() => Math.random() - 0.5);
            let sourceFile = null;
            for (const file of shuffled) {
                try {
                    const meta = await sharp(join(imagesDir, file)).metadata();
                    if (meta.width && meta.width >= OG_WIDTH) {
                        sourceFile = join(imagesDir, file);
                        break;
                    }
                } catch { /* skip */ }
            }
            if (!sourceFile) continue;

            await sharp(sourceFile)
                .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
                .webp({ quality: 85 })
                .toFile(outputFile);

            // Remove legacy og.svg if present
            const legacyFile = join(imagesDir, OG_LEGACY);
            if (existsSync(legacyFile)) unlinkSync(legacyFile);
        }
    });

    // Draft Preprocessor
    eleventyConfig.addPreprocessor("drafts", "*", (data, content) => {
        if (data.draft) {
            data.title = `${data.title} (draft)`;
        }
        return data.draft && process.env.ELEVENTY_RUN_MODE === "build" ? false : content;
    });

    // Transform: Remove Empty Attributes
    eleventyConfig.addTransform("removeEmptyAttrs", (content, outputPath) => {
        if (outputPath && outputPath.endsWith(".html")) {
            return content.replace(/data-pagefind-body=""/g, 'data-pagefind-body');
        }
        return content;
    });

    // Filter: Add .ffirst class to first <img> inside first <figure> – used in post.njk for 'reading'-tagged posts
    eleventyConfig.addFilter("addFfirstClass", function(content) {
        return (content || "").replace(/<figure[^>]*>[\s\S]*?<\/figure>/i, (figureBlock) => {
            return figureBlock.replace(/<img([^>]*?)(\s*\/?)>/i, (match, attrs, selfClose) => {
                if (/\bclass="([^"]*)"/.test(attrs)) {
                    return `<img${attrs.replace(/\bclass="([^"]*)"/, 'class="ffirst $1"')}${selfClose}>`;
                } else if (/\bclass='([^']*)'/.test(attrs)) {
                    return `<img${attrs.replace(/\bclass='([^']*)'/, "class='ffirst $1'")}${selfClose}>`;
                }
                return `<img class="ffirst"${attrs}${selfClose}>`;
            });
        });
    });

eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return DateTime.fromJSDate(dateObj).toISODate(); // Customize format as needed
});

    // Filter: Readable Date
    eleventyConfig.addFilter("readableDate", (dateObj, format = "dd LLLL yyyy", zone = "Asia/Hong_Kong") => {
        return DateTime.fromJSDate(dateObj, { zone }).toFormat(format);
    });

    // Filter: Readable Time – returns the hour rounded to nearest hour (e.g. "3pm").
    // Returns an empty string for date-only posts (stored as UTC midnight) so they show no time.
    eleventyConfig.addFilter("readableTime", (dateObj, zone = "Asia/Hong_Kong") => {
        const utc = DateTime.fromJSDate(dateObj, { zone: "utc" });
        if (utc.hour === 0 && utc.minute === 0 && utc.second === 0) return '';
        const dt = DateTime.fromJSDate(dateObj, { zone });
        const rounded = dt.minute >= 30
            ? dt.plus({ hours: 1 }).startOf('hour')
            : dt.startOf('hour');
        return rounded.toFormat('ha').toLowerCase();
    });

    // Add Plugins
    const plugins = [
        { plugin: IdAttributePlugin, options: { checkDuplicates: false } },
        { plugin: syntaxHighlight, options: { preAttributes: { tabindex: 0 } } },
        { plugin: pluginNavigation },
        { plugin: HtmlBasePlugin },
        { plugin: InputPathToUrlTransformPlugin },
        {
            plugin: eleventyImageTransformPlugin,
            options: {
                formats: ["webp" ],
                widths: [500, 838],
                urlPath: "/img",
                // Output processed images to _site/img directory
                // This allows Share posts to use markdown image syntax like:
                // ![alt text](/posts/slug/images/photo.jpg)
                // which will be automatically transformed to responsive webp images
                outputDir: "./_site/img",
                htmlOptions: {
                    imgAttributes: {
                        loading: "lazy",
                        decoding: "async",
                    },
                },
            },
        },
    ];

    plugins.forEach(({ plugin, options }) => {
        eleventyConfig.addPlugin(plugin, options);
    });

    // Markdown Setup
    const md = markdownIt({ html: true, linkify: true, typographer: true })
        .use(footnote_plugin)
        .use(markdownItLinkAttributes, {
            matcher: href => /^https?:\/\//.test(href) && !href.includes("daveross.name"),
            attrs: { class: "ext-link", target: "_blank", rel: "noopener noreferrer" },
        });

    eleventyConfig.setLibrary("md", md);

    // Markdown Filter - allows rendering markdown strings in templates
    eleventyConfig.addFilter("renderMarkdown", (content) => {
        return md.render(content || "");
    });

    // Shortcodes
    const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    eleventyConfig.addShortcode('figure', (src, alt, caption = '') => `<figure oncontextmenu="return false;">
    <img src="${escAttr(src)}" alt="${escAttr(alt)}">
    ${caption ? `<figcaption>${escAttr(caption)}</figcaption>` : ''}
</figure>`);

    eleventyConfig.addShortcode("youtube", function(shareUrl) {
        const videoId = shareUrl.split('/').pop().split('?')[0];
        const frameTitle = this?.ctx?.title
            ? `YouTube video: ${escAttr(this.ctx.title)}`
            : "Embedded YouTube video";
        return `
            <figure class="yt-wrapper" oncontextmenu="return false;">
                <iframe
                    src="https://www.youtube.com/embed/${videoId}"
                    title="${frameTitle}"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen>
                </iframe>
            </figure>
        `;
    });

    eleventyConfig.addShortcode("sizing", function(fileName, width, caption = '') {
        const widthValue = width.toString().replace('%', '');
        // Get the current page's URL to construct absolute image paths
        // This ensures images work when rendered on index page (Share posts) or post page
        const pageUrl = this.page?.url || '/';
        const postSlug = pageUrl.split('/').filter(Boolean).pop() || '';
        const imagePath = postSlug ? `/posts/${postSlug}/images/${fileName}` : `./images/${fileName}`;
        return `
        <figure class="figure--sizing" style="width: ${widthValue}%" oncontextmenu="return false;">
            <img src="${imagePath}" alt="${caption || fileName}">
            ${caption ? `<figcaption>${caption}</figcaption>` : ''}
        </figure>
    `;
    });

    eleventyConfig.addShortcode("callout", words => `<span class="callout">${words}</span>`);
    eleventyConfig.addShortcode("hr", () => `<div class="hr">&mdash;&diams;&mdash;&mdash;&diams;&mdash;&mdash;&diams;&mdash;</div>`);

    // Collections
    const collections = [
        { name: "postsSorted", filter: "./content/posts/**/*.md", sort: (a, b) => b.date - a.date },
        { name: "posts", filter: "./content/posts/**/*.md" },

       
    ];

    collections.forEach(({ name, filter, tag, sort }) => {
        if (tag) {
            eleventyConfig.addCollection(name, collectionApi => 
                collectionApi.getFilteredByTag(tag).sort(sort)
            );
        } else {
            eleventyConfig.addCollection(name, collectionApi => 
                collectionApi.getFilteredByGlob(filter).sort(sort)
            );
        }
    });

    eleventyConfig.addCollection("writers", collectionApi => {
        return getAllWriters(collectionApi.getAll());
    });

    eleventyConfig.addCollection("artists", collectionApi => {
        return getAllArtists(collectionApi.getAll());
    });

eleventyConfig.addCollection("navigablePosts", (collectionApi) => {
    return collectionApi.getFilteredByTag("posts").filter(item => {
      return item.data.skipInNav !== true;
    });
  });


    // Filters
eleventyConfig.addFilter("getAllWriters", (collection = []) => getAllWriters(collection));
eleventyConfig.addFilter("getAllArtists", (collection = []) => getAllArtists(collection));

eleventyConfig.addFilter("getWriterBio", (collection = [], writer) => {
    const posts = collection
        .filter(item => getItemWriters(item).includes(writer))
        .sort((a, b) => b.date - a.date);
    for (const post of posts) {
        // First check for bio-writer-name format
        const slugifiedWriter = writer.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const bioKey = `bio-${slugifiedWriter}`;
        if (post.data?.[bioKey]) return post.data[bioKey];
        // Fall back to legacy single bio field for backwards compatibility
        if (post.data?.bio) return post.data.bio;
    }
    return null;
});

eleventyConfig.addFilter("getWriterPortrait", (collection = [], writer) => {
    const posts = collection
        .filter(item => getItemWriters(item).includes(writer))
        .sort((a, b) => b.date - a.date);

    const slugifiedWriter = writer
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    for (const post of posts) {
        const postSlug = post.url.split('/').filter(Boolean).pop();

        // First check for portrait-writer-name format (new format)
        const portraitKey = `portrait-${slugifiedWriter}`;
        if (post.data?.[portraitKey]) {
            return `/posts/${postSlug}/images/${post.data[portraitKey]}`;
        }

        // Fall back to legacy single portrait field for backwards compatibility
        if (post.data?.portrait) {
            return `/posts/${postSlug}/images/${post.data.portrait}`;
        }
    }
    return null;
});

eleventyConfig.addFilter("getArtistPortrait", (collection = [], artist) => {
    const posts = collection
        .filter(item => getItemArtists(item).includes(artist))
        .sort((a, b) => b.date - a.date);

    const slugifiedArtist = artist
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    for (const post of posts) {
        const postSlug = post.url.split('/').filter(Boolean).pop();

        // First check for portrait-artist-name format (new format)
        const portraitKey = `portrait-${slugifiedArtist}`;
        if (post.data?.[portraitKey]) {
            return `/posts/${postSlug}/images/${post.data[portraitKey]}`;
        }

        // Fall back to legacy single portrait field for backwards compatibility
        if (post.data?.portrait) {
            return `/posts/${postSlug}/images/${post.data.portrait}`;
        }
    }
    return null;
});

eleventyConfig.addFilter("getArtistBio", (collection = [], artist) => {
    const posts = collection
        .filter(item => getItemArtists(item).includes(artist))
        .sort((a, b) => b.date - a.date);
    for (const post of posts) {
        // First check for bio-artist-name format
        const slugifiedArtist = artist.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const bioKey = `bio-${slugifiedArtist}`;
        if (post.data?.[bioKey]) return post.data[bioKey];
        // Fall back to legacy single bio field for backwards compatibility
        if (post.data?.bio) return post.data.bio;
    }
    return null;
});

eleventyConfig.addFilter("getWriterPosts", (collection = [], writer) => {
    return collection
        .filter(item => getItemWriters(item).includes(writer))
        .sort((a, b) => b.date - a.date);
});

eleventyConfig.addFilter("getArtistPosts", (collection = [], artist) => {
    return collection
        .filter(item => getItemArtists(item).includes(artist))
        .sort((a, b) => b.date - a.date);
});

    eleventyConfig.addGlobalData("siteName", "Dave Ross");
    eleventyConfig.addFilter("hasTag", (tags = [], tag) => tags.includes(tag));

    eleventyConfig.addFilter("filterByTags", (collection = [], tagsToInclude = []) => {
        return collection.filter(item => {
            const itemTags = toArray(item.data?.tags);
            return tagsToInclude.some(tag => itemTags.includes(tag));
        });
    });

    eleventyConfig.addFilter("getAllTags", collection => {
        const tagCount = {};
        collection.forEach(item => {
            (item.data.tags || []).forEach(tag => {
                tagCount[tag] = (tagCount[tag] || 0) + 1;
            });
        });
        return Object.keys(tagCount).sort();
    });

    eleventyConfig.addFilter("filterTagList", tags => 
        (tags || []).filter(tag => !["all", "nav", "post", "posts", "share"].includes(tag))
    );

    eleventyConfig.addNunjucksFilter("withTwoTags", (items, tagA, tagB) => {
        const seen = new Set();
        return items.filter(item => {
            let tags = item.data?.tags;
            if (typeof tags === "string") tags = [tags];
            if (!Array.isArray(tags) || !(tags.includes(tagA) || tags.includes(tagB))) return false;
            if (seen.has(item.url)) return false;
            seen.add(item.url);
            return true;
        });
    });

eleventyConfig.addCollection("blogAndLinks", function(collectionApi) {
  return collectionApi.getAll().filter(item => {
    let tags = item.data?.tags;
    if (typeof tags === "string") tags = [tags];
    return Array.isArray(tags) &&
           (tags.includes("blog") || tags.includes("extlink"));
  })
    .sort((a, b) => b.date - a.date); // newest first
});

eleventyConfig.addCollection("postsForNav", function(collectionApi) {
  return collectionApi.getFilteredByTag("posts").filter(post => {
    return !post.data.tags?.includes("extlink") && !post.data.excludeFromNav;
  });
});

 eleventyConfig.addNunjucksFilter("widont", (value) => {
    if (value == null) return value;
    return widont(value);
  });

/*
eleventyConfig.addFilter("getPreviousCollectionItem", function(collection) {
  const index = collection.findIndex(item => item.url === this.page.url);
  return collection[findex - 1];
});

eleventyConfig.addFilter("getNextCollectionItem", function(collection) {
  const index = collection.findIndex(item => item.url === this.page.url);
  return collection[index + 1];
});
*/

    // Passthrough Copies
    const passthroughPaths = {
        "public": "public",
        "pagefind": "pagefind",
        "css": "css",
        "js": "js",
        "favicon.ico": "favicon.ico",
        "favicon-96x96": "favicon-96x96",
        "img": "img"
    };
    Object.entries(passthroughPaths).forEach(([src, dest]) => {
        eleventyConfig.addPassthroughCopy({ [src]: dest });
    });

    eleventyConfig.addPassthroughCopy("**/images/");
    eleventyConfig.addPassthroughCopy("**/files/");
    eleventyConfig.addPassthroughCopy("content/css");
    eleventyConfig.addPassthroughCopy("auth");
    eleventyConfig.addPassthroughCopy({ "content/_redirects": "_redirects" });

    // Passthrough: Cover images referenced in each post's front matter
    const postsRoot = join("content", "posts");
    if (existsSync(postsRoot)) {
        const postDirs = readdirSync(postsRoot).filter(name => {
            try { return statSync(join(postsRoot, name)).isDirectory(); } catch { return false; }
        });
        for (const slug of postDirs) {
            const mdPath = join(postsRoot, slug, "index.md");
            if (!existsSync(mdPath)) continue;
            const raw = readFileSync(mdPath, "utf8");
            const coverMatch = raw.match(/^cover:\s*(.+?)\s*$/m);
            if (!coverMatch) continue;
            const coverFile = coverMatch[1].replace(/^["']|["']$/g, "");
            const src = join(postsRoot, slug, "images", coverFile);
            if (existsSync(src)) {
                eleventyConfig.addPassthroughCopy({
                    [src]: `img/covers/${coverFile}`
                });
            }
        }
    }

    // Watch Targets
    eleventyConfig.addWatchTarget("css/**/*.css");
    eleventyConfig.addWatchTarget("**/*.{svg,webp,png,jpg,jpeg,gif}");


// Return all tags used in a collection with counts
eleventyConfig.addFilter("getAllTags", collection => {
    const tagCount = {};
  
    // Count occurrences of each tag
    for (let item of collection) {
        (item.data.tags || []).forEach(tag => {
            tagCount[tag] = (tagCount[tag] || 0) + 1;
        });
    }

// Add copy button for code blocks


    // Filter tags used in more than one post - look at /combo/index.njk

    const filteredTags = Object.keys(tagCount); // .filter(tag => tagCount[tag] > 1) 
    return filteredTags.sort();  // Attach alpha filter here
});

// Filter out unwanted tags
eleventyConfig.addFilter("filterTagList", function filterTagList(tags) {
    return (tags || []).filter(tag => ["all", "nav", "post", "posts", "share"].indexOf(tag) === -1);
});







    // Front Matter Parsing Options
    eleventyConfig.setFrontMatterParsingOptions({
        excerpt: true,
        excerpt_separator: "<!-- snip -->",
    });

    // Configuration Object
    return {
        templateFormats: ["md", "njk", "html", "liquid", "11ty.js"],
        markdownTemplateEngine: "njk",
        htmlTemplateEngine: "njk",
        dir: {
            input: "content",
            includes: "../_includes",
            data: "../_data",
            output: "_site"
        },
    };
}
