const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const POSTS_DIR = '/home/runner/work/simple/simple/content/posts';
const targetTags = ['share', 'ipad', 'photography'];

const entries = fs.readdirSync(POSTS_DIR, { withFileTypes: true });

entries.forEach(entry => {
  if (entry.isDirectory()) {
    const mdPath = path.join(POSTS_DIR, entry.name, 'index.md');
    if (fs.existsSync(mdPath)) {
      try {
        const { data } = matter(fs.readFileSync(mdPath, 'utf8'));
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const matchedTags = tags.filter(tag => targetTags.includes(tag));
        if (matchedTags.length > 0) {
          console.log(`${entry.name}: ${matchedTags.join(', ')}`);
        }
      } catch (err) {
        // skip
      }
    }
  }
});
