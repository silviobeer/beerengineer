function kebabCaseToken(name) {
    return name.replaceAll(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}
function renderPaletteSelectors(selectors, palette) {
    const lines = Object.entries(palette).map(([name, value]) => `  --color-${kebabCaseToken(name)}: ${value};`);
    return `${selectors.join(", ")} {\n${lines.join("\n")}\n}`;
}
function fontStack(font, fallback) {
    return font?.family?.trim() || fallback;
}
export function renderDesignTokensCss(design) {
    const sections = [
        renderPaletteSelectors([":root", "html.light", '[data-theme="light"]'], design.tokens.light),
    ];
    if (design.tokens.dark) {
        sections.push(`@media (prefers-color-scheme: dark) {\n${renderPaletteSelectors([":root"], design.tokens.dark)
            .split("\n")
            .map(line => `  ${line}`)
            .join("\n")}\n}`, renderPaletteSelectors(["html.dark", '[data-theme="dark"]'], design.tokens.dark));
    }
    sections.push("*, *::before, *::after { border-radius: 0 !important; }", [
        ":root {",
        `  --font-display: ${fontStack(design.typography.display, "system-ui, sans-serif")};`,
        `  --font-body: ${fontStack(design.typography.body, "system-ui, sans-serif")};`,
        `  --font-mono: ${fontStack(design.typography.mono, "ui-monospace, monospace")};`,
        ...Object.entries(design.typography.scale).map(([name, value]) => `  --font-size-${name}: ${value};`),
        `  --space-base-unit: ${design.spacing.baseUnit};`,
        `  --space-section-padding: ${design.spacing.sectionPadding};`,
        `  --space-card-padding: ${design.spacing.cardPadding};`,
        `  --content-max-width: ${design.spacing.contentMaxWidth};`,
        `  --border-buttons: ${design.borders.buttons};`,
        `  --border-cards: ${design.borders.cards};`,
        `  --border-badges: ${design.borders.badges};`,
        ...Object.entries(design.shadows).map(([name, value]) => `  --shadow-${name}: ${value};`),
        "}",
    ].join("\n"));
    return `${sections.join("\n\n")}\n`;
}
