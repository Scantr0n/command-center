module.exports = {
  // public/vendor is a checked-in third-party bundle (see
  // scripts/build-vendor-d3.js), never hand-written markup, so it can't
  // contain a Tailwind class to find; excluding it keeps every build:css
  // run from re-scanning it for nothing.
  content: ["./public/**/*.html", "./public/**/*.js", "!./public/vendor/**"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Manrope', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      }
      // No colors extension: the real palette (--void, --panel, --ink, etc.)
      // lives as CSS custom properties in each page's own <style>, consumed
      // via var(--x) and inline styles, never as bg-void/text-ink utility
      // classes, so a colors block here would just be unused config that
      // could drift from the real values without anything ever catching it.
    }
  }
}
