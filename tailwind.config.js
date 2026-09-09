module.exports = {
  content: ["./public/**/*.html", "./public/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Manrope', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        void: '#0A0B0D',
        panel: '#14161A',
        panelLight: '#1C1F24',
        border: '#2A2E35',
        ink: '#E8E9EB',
        sub: '#8B909A',
        faint: '#565B64',
      }
    }
  },
  safelist: [
    { pattern: /bg-\[#.{6}\]/ },
    { pattern: /border-\[#.{6}\]/ },
    { pattern: /text-\[#.{6}\]/ },
  ]
}
