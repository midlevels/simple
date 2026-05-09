function stripNunjucksShortcodes(content = "") {
  return content
    // Remove Nunjucks
    .replace(/{%[\s\S]*?%}/g, "")
    .replace(/{{[\s\S]*?}}/g, "")

    // Remove everything after excerpt comment
    //   .replace(/<!-- excerpt -->.*$/s, "")

    // Modified excerpt to snip and edited md files.
    .replace(/<!-- snip -->[\s\S]*/g, "")

    // Remove <a> tags but keep the content
    .replace(/<a[\s\S]*?<\/a>/gi, (match) => match.replace(/<a[^>]*>/, "").replace(/<\/a>/, ""))

    // Remove <figure> blocks entirely
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")

    // Remove <blockquote> blocks entirely
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")

    // Remove standalone <img> tags
    .replace(/<img[^>]*>/gi, "")

    // Remove empty paragraphs
    .replace(/<p>\s*<\/p>/g, "")
    
    // Remove <figcaption>
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, "")

    .trim();
}
export default class {
  data() {
    return {
      permalink: "/feed.xml",
      eleventyExcludeFromCollections: true,
      layout: false,
    };
  }

render(data) {
const posts = data.collections.all
  .filter(post => post.data.tags?.includes("posts"))
  .filter(post => !Boolean(post.data.linky))
  .sort((a, b) => b.date - a.date)
  .slice(0, 16);

  const updatedDate = posts.length > 0
    ? posts[0]?.date.toISOString()
    : new Date().toISOString();





  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Dave Ross</title>
  <link href="https://daveross.name/feed.xml" rel="self"/>
  <link href="https://daveross.name/"/>
  <updated>${updatedDate}</updated>
  <id>https://daveross.name/</id>

  ${posts.map(post => {
    const snip = stripNunjucksShortcodes(
      post.page.snip || post.content
    );

    return `
    <entry>
      <title>${post.data.title}</title>
      <link href="https://daveross.name${post.url}"/>
      <id>https://daveross.name${post.url}</id>
      <updated>${post.date.toISOString()}</updated>
      <content type="html"><![CDATA[
        ${snip}
      ]]></content>
    </entry>`;
  }).join("")}
</feed>`;



}
}
