# CSS Architecture Documentation

This project uses a modular CSS architecture for improved maintainability and organization.

## Directory Structure

```
css/
├── index.css                    # Main entry point with @import statements
├── index-original.css           # Backup of original monolithic CSS (2,183 lines)
│
├── base/                        # Foundation styles
│   ├── fonts.css               # All @font-face declarations
│   ├── variables.css           # CSS custom properties (colors, spacing, etc.)
│   ├── reset.css               # Global resets and normalizations
│   └── typography.css          # Base text styles (headings, paragraphs, lists)
│
├── layout/                      # Page structure
│   ├── header.css              # Site header and main navigation
│   ├── main.css                # Main content area layout
│   └── footer.css              # Footer and footer links
│
├── components/                  # Reusable UI components
│   ├── links.css               # Link styles and variations
│   ├── buttons.css             # Buttons, pagination, theme toggle
│   ├── tags.css                # Tag styling and metadata
│   ├── figures.css             # Images, figures, YouTube embeds
│   ├── code.css                # Code blocks and syntax highlighting
│   ├── blockquotes.css         # Blockquotes and callout boxes
│   ├── navigation.css          # Mobile navigation and hamburger menu
│   ├── search.css              # Search modal
│   └── share-posts.css         # Share post special styling
│
├── pages/                       # Page-specific styles
│   └── post-list.css           # Homepage and archive listings
│
└── utilities/                   # Helpers and responsive styles
    ├── helpers.css             # Utility classes
    └── media-queries.css       # Responsive breakpoints
```

## Benefits of This Structure

1. **Easier Maintenance**: Find and modify styles quickly by component or concern
2. **Better Collaboration**: Multiple developers can work on different files without conflicts
3. **Clear Dependencies**: See what imports what in the cascade order
4. **Selective Loading**: Can conditionally load certain components if needed
5. **Better Version Control**: Git diffs show changes to specific components
6. **Reduced Cognitive Load**: Work with 100-300 line files instead of 2,000+ lines
7. **Self-Documenting**: File structure reflects the UI architecture

## Import Order (Cascade)

The `index.css` file imports modules in this specific order to maintain proper CSS cascade:

1. **Base Styles** - Foundation (fonts, variables, resets, typography)
2. **Layout** - Page structure (header, main, footer)
3. **Components** - Reusable UI elements
4. **Pages** - Page-specific styles
5. **Utilities** - Helper classes and media queries (last to allow overrides)

## Making Changes

### To modify existing styles:

1. Identify the component or concern (e.g., "button styles")
2. Open the relevant file (e.g., `components/buttons.css`)
3. Make your changes
4. Run `npm run build` to test

### To add new styles:

1. Determine the appropriate directory (base, layout, components, pages, utilities)
2. Either add to an existing file or create a new one
3. If creating a new file, add an `@import` statement in `index.css`
4. Place the import in the correct cascade order

### To add a new component:

1. Create `css/components/your-component.css`
2. Add component documentation at the top:
   ```css
   /**
    * Component Name
    * Brief description of what this component does
    */
   ```
3. Add `@import 'components/your-component.css';` to `index.css`

## Build Process

The build system:
- Preserves the modular structure in the output (`_site/css/`)
- Copies all CSS files to maintain source organization
- Applies PostCSS transformations (PurgeCSS for production)

## File Size Reference

- Original monolithic CSS: **2,183 lines** in a single file
- New modular structure: **21 files** with clear separation of concerns

## Dark Mode

Dark mode variables and overrides are defined in `base/variables.css`:
- `:root` - Light mode defaults
- `@media (prefers-color-scheme: dark)` - System preference
- `[data-theme=dark]` - Explicit theme override

## Responsive Design

Media queries are consolidated in `utilities/media-queries.css`:
- Mobile: `max-width: 768px`
- Tablet: `max-width: 800px`
- Desktop: `min-width: 801px`

## Special Features

### Share Posts
Share posts have special styling defined in `components/share-posts.css`:
- Distinct background color (`--share-bg`)
- Special border treatment
- Full content display
- Responsive media handling

### YouTube Embeds
YouTube embed styling in `components/figures.css`:
- `.yt-wrapper` class for consistent sizing
- 16:9 aspect ratio maintained
- Magazine "bleed" effect matching figures

## CSS Variables (Design Tokens)

All design tokens are centralized in `base/variables.css`:
- Colors (backgrounds, text, highlights)
- Typography (fonts, sizes)
- Spacing scale
- Shadows
- Z-index scale
- Transitions
- Border radius values

## Naming Conventions

- **BEM-inspired**: Use descriptive class names (e.g., `.post-list`, `.nav-links`)
- **Component-scoped**: Prefix component-specific classes (e.g., `.share-post`)
- **Utility classes**: Generic helpers (e.g., `.twocol`, `.toph`)
- **State classes**: Use `is-*` prefix (e.g., `.is-open`, `.is-visible`)

## Testing Changes

After making CSS changes:

```bash
# Build the site
npm run build

# Build and serve locally
npm start

# Build with production optimizations
npm run build:all
```

## Migration Notes

The original monolithic CSS file has been preserved as `css/index-original.css` for reference. All functionality has been maintained in the new modular structure.

## Future Improvements

Potential enhancements to consider:
- Add CSS custom property fallbacks for older browsers
- Create a living style guide
- Add CSS linting rules
- Consider CSS modules or scoped styles for components
- Document component dependencies more explicitly
