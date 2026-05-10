---
title: HKBC Annual Text Archive
layout: layouts/base.njk
pageName: HKBC Archive
---
<p style="text-align: right;"><a href="/history">HKBC history</a></p>
<article>
<div class="page-links post-content">
{% set showYear = true %}
{% set postslist = collections.hkbc | reverse %}
{% include "yearlist.njk" %}
</div>
</article>