import purgecss from '@fullhuman/postcss-purgecss'

export default {
  plugins: [
    purgecss({
      content: [
        './content/**/*.html',
        './content/*.njk',
        './content/*.md',
        './public/js/*.js'
      ],
      safelist: {
        standard: ['/^hljs-/', 'dark', 'light', 'is-active', 'active', 'hover'] 
      }
    })
  ]
}
