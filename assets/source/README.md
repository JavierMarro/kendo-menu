# Brand source assets

These originals and the social-card text overlay are authoring inputs, outside Vite's `public`
directory. They must not be copied into `apps/web/public` or the PWA precache. Production variants
live in `apps/web/public/assets`; the JPEGs here preserve the established artwork for future edits.

The 2026-09-08 variants were encoded using an already installed local Sharp 0.34.5 / libvips 8.17.3
with AVIF and WebP support. No dependency or lockfile change was needed. Regeneration is an offline
authoring operation, not part of the application build. Use an existing Sharp installation:

```javascript
const sharp = require(process.env.KENDOMENU_SHARP_PATH);
const source = 'assets/source';
const output = 'apps/web/public/assets';

async function generate() {
  for (const name of ['logo', 'hero']) {
    const widths = name === 'logo' ? [44, 88, 176, 264] : [768, 1280, 1920, 2752];
    for (const width of widths) {
      let input = sharp(`${source}/kendo-menu-${name}.jpeg`);
      if (name === 'logo') {
        // Preserve the former 3x zoom inside an 88x44 CSS-pixel frame.
        input = input.extract({ left: 939, top: 533, width: 938, height: 470 });
      }
      const pixels = await input
        .resize({ width, height: name === 'logo' ? width / 2 : undefined })
        .png()
        .toBuffer();
      await sharp(pixels)
        .avif({ quality: 60, effort: 6, chromaSubsampling: '4:4:4' })
        .toFile(`${output}/kendo-menu-${name}-${width}.avif`);
      await sharp(pixels)
        .webp({ quality: 82, effort: 6 })
        .toFile(`${output}/kendo-menu-${name}-${width}.webp`);
      await sharp(pixels)
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(`${output}/kendo-menu-${name}-${width}.jpeg`);
    }
  }
  const hero = await sharp(`${source}/kendo-menu-hero.jpeg`)
    .resize(1200, 630, { fit: 'cover' })
    .toBuffer();
  const logo = await sharp(`${source}/kendo-menu-logo.jpeg`)
    .extract({ left: 939, top: 533, width: 938, height: 470 })
    .resize(132, 66)
    .png()
    .toBuffer();
  await sharp(hero)
    .composite([
      { input: `${source}/kendo-menu-social-overlay.svg` },
      { input: logo, left: 72, top: 67 },
    ])
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(`${output}/kendo-menu-social.jpg`);
}

generate().catch((error) => {
  throw error;
});
```

The SVG overlay uses Arial, matching the existing sans-serif identity. Font availability and encoder
versions can change exact bytes; inspect the resulting 1200×630 card at thumbnail size after
regeneration. Keep the social JPEG publicly fetchable but excluded from precaching: it is for
external link previews, not offline app rendering.
