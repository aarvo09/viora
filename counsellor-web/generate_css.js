const fs = require('fs');
const html = fs.readFileSync('dashboard.html', 'utf8');

const tailwindConfigStr = html.match(/tailwind\.config=\{([\s\S]*?)\};/)[1];
// Evaluate the config to an object (it's safe since it's from Stitch)
const config = eval('({' + tailwindConfigStr + '})');
const theme = config.theme.extend;

let css = '\n/* Stitch Generated Classes */\n:root {\n';
for (const [name, color] of Object.entries(theme.colors || {})) {
  css += `  --${name}: ${color};\n`;
}
for (const [name, val] of Object.entries(theme.spacing || {})) {
  css += `  --spacing-${name}: ${val};\n`;
}
css += '}\n\n';

// Colors
for (const [name, color] of Object.entries(theme.colors || {})) {
  css += `.bg-${name} { background-color: var(--${name}); }\n`;
  css += `.text-${name} { color: var(--${name}); }\n`;
  css += `.border-${name} { border-color: var(--${name}); }\n`;
}

// Spacing (padding, margin, gap)
const spacingPrefixes = {
  'p': 'padding', 'pt': 'padding-top', 'pb': 'padding-bottom', 'pl': 'padding-left', 'pr': 'padding-right', 'px': ['padding-left', 'padding-right'], 'py': ['padding-top', 'padding-bottom'],
  'm': 'margin', 'mt': 'margin-top', 'mb': 'margin-bottom', 'ml': 'margin-left', 'mr': 'margin-right', 'mx': ['margin-left', 'margin-right'], 'my': ['margin-top', 'margin-bottom'],
  'gap': 'gap'
};
for (const [name, val] of Object.entries(theme.spacing || {})) {
  for (const [prefix, prop] of Object.entries(spacingPrefixes)) {
    if (Array.isArray(prop)) {
      css += `.${prefix}-${name} { ${prop[0]}: var(--spacing-${name}); ${prop[1]}: var(--spacing-${name}); }\n`;
    } else {
      css += `.${prefix}-${name} { ${prop}: var(--spacing-${name}); }\n`;
    }
  }
}

// Typography (font-family, font-size, font-weight, line-height, letter-spacing)
for (const [name, val] of Object.entries(theme.fontSize || {})) {
  const size = val[0];
  const details = val[1] || {};
  css += `.text-${name} { font-size: ${size};`;
  if (details.lineHeight) css += ` line-height: ${details.lineHeight};`;
  if (details.fontWeight) css += ` font-weight: ${details.fontWeight};`;
  if (details.letterSpacing) css += ` letter-spacing: ${details.letterSpacing};`;
  css += ` }\n`;
}
for (const [name, val] of Object.entries(theme.fontFamily || {})) {
  css += `.font-${name} { font-family: '${val[0]}', sans-serif; }\n`;
}

// Border radius
for (const [name, val] of Object.entries(theme.borderRadius || {})) {
  const suffix = name === 'DEFAULT' ? '' : `-${name}`;
  css += `.rounded${suffix} { border-radius: ${val}; }\n`;
}

// Specific classes seen in HTML
css += `
.w-full { width: 100%; }
.h-full { height: 100%; }
.flex { display: flex; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-1 { flex: 1; }
.flex-wrap { flex-wrap: wrap; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.items-end { align-items: flex-end; }
.items-baseline { align-items: baseline; }
.justify-between { justify-content: space-between; }
.justify-center { justify-content: center; }
.justify-end { justify-content: flex-end; }
.justify-start { justify-content: flex-start; }
.grid { display: grid; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.relative { position: relative; }
.absolute { position: absolute; }
.fixed { position: fixed; }
.block { display: block; }
.inline-flex { display: inline-flex; }
.hidden { display: none; }
.overflow-hidden { overflow: hidden; }
.overflow-x-auto { overflow-x: auto; }
.whitespace-nowrap { white-space: nowrap; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
.border { border-width: 1px; border-style: solid; }
.border-b { border-bottom-width: 1px; border-bottom-style: solid; }
.border-t { border-top-width: 1px; border-top-style: solid; }
.border-l { border-left-width: 1px; border-left-style: solid; }
.border-r { border-right-width: 1px; border-right-style: solid; }
.min-w-0 { min-width: 0; }
.min-h-screen { min-height: 100vh; }
.tracking-tight { letter-spacing: -0.025em; }
.tracking-wide { letter-spacing: 0.025em; }
.tracking-wider { letter-spacing: 0.05em; }
.uppercase { text-transform: uppercase; }
.antialiased { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
.z-40 { z-index: 40; }
.z-50 { z-index: 50; }
.shrink-0 { flex-shrink: 0; }
.cursor-pointer { cursor: pointer; }
.cursor-default { cursor: default; }
.opacity-75 { opacity: 0.75; }
.opacity-50 { opacity: 0.5; }
.ring-2 { box-shadow: 0 0 0 2px var(--tw-ring-color, currentColor); }
.ring-4 { box-shadow: 0 0 0 4px var(--tw-ring-color, currentColor); }
.transition-colors { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
.animate-ping { animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }

/* Responsive basics */
@media (min-width: 640px) {
  .sm\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sm\\:flex-row { flex-direction: row; }
  .sm\\:items-center { align-items: center; }
  .sm\\:justify-between { justify-content: space-between; }
}
@media (min-width: 768px) {
  .md\\:flex-row { flex-direction: row; }
  .md\\:items-center { align-items: center; }
  .md\\:justify-between { justify-content: space-between; }
  .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .md\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .lg\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .lg\\:grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .lg\\:col-span-8 { grid-column: span 8 / span 8; }
  .lg\\:col-span-4 { grid-column: span 4 / span 4; }
}

/* Specific sizing */
.w-1 { width: 0.25rem; }
.h-1 { height: 0.25rem; }
.w-1\\.5 { width: 0.375rem; }
.h-1\\.5 { height: 0.375rem; }
.w-2 { width: 0.5rem; }
.h-2 { height: 0.5rem; }
.w-2\\.5 { width: 0.625rem; }
.h-2\\.5 { height: 0.625rem; }
.w-3 { width: 0.75rem; }
.h-3 { height: 0.75rem; }
.w-4 { width: 1rem; }
.h-4 { height: 1rem; }
.w-8 { width: 2rem; }
.h-8 { height: 2rem; }
.w-9 { width: 2.25rem; }
.h-9 { height: 2.25rem; }
.w-10 { width: 2.5rem; }
.h-10 { height: 2.5rem; }
.max-w-lg { max-width: 32rem; }
.max-w-xs { max-width: 20rem; }
.pl-10 { padding-left: 2.5rem; }
.pr-14 { padding-right: 3.5rem; }
.-left-6 { left: -1.5rem; }
.top-0 { top: 0; }
.left-0 { left: 0; }
.right-0 { right: 0; }
.bottom-0 { bottom: 0; }
.top-1 { top: 0.25rem; }
.right-1 { right: 0.25rem; }
`;

fs.writeFileSync('stitch-tokens.css', css);
