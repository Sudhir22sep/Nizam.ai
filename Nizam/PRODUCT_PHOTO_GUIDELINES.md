# Amma Wears — Visual Asset Guidelines

**Document Version:** 1.0  
**Last Updated:** 2026-09-18  
**Brand:** Amma Wears — Everyday Luxury for Modern Wardrobes  
**Design System Palette:** Midnight Slate `#1E2A38` · Warm Ivory `#F7F5F1` · Antique Brass `#B08D57`

---

## 1. Product Photo Standards

### 1.1 Aspect Ratios by Shot Type

| Shot Type              | Aspect Ratio | Recommended Size       | Use Case                              |
|------------------------|--------------|------------------------|---------------------------------------|
| **Flat lay**           | 1:1          | 2000×2000 px (min 1200) | Grid thumbnails, PLP cards            |
| **Model — full body**  | 4:5          | 2000×2500 px            | PDP main image, campaign hero         |
| **Model — 3/4 torso**  | 4:5 or 1:1   | 1600×2000 px            | PDP alternate, category banners       |
| **Detail / close-up**  | 1:1          | 1200×1200 px            | PDP detail gallery, fabric texture    |
| **Shoes (3/4 angle)**  | 1:1          | 1200×1200 px            | Footwear product cards                |
| **Accessories**        | 1:1          | 1200×1200 px            | Bags, jewelry, scarves                |

> **Enforcement:** All product images must be cropped to the correct aspect ratio *before* upload — never rely on CSS `object-fit` to do the job.

### 1.2 Composition Rules

#### Flat Lays
- Centered product with **10% padding** around all edges
- Even, shadowless lighting — no single harsh shadow crossing the garment
- Background must be consistent across the entire catalog:
  - **Primary:** Pure white `#FFFFFF` or Warm Ivory `#F7F5F1`
  - **Alternative:** Same gray/neutral throughout (no mixed backgrounds)
- No props that distract from the garment shape

#### Model Shots (4:5 Vertical)
- Model fills **80% of frame** height
- Crop point consistent: **mid-thigh** for full-body, **waist** for torso shots
- Face optional — focus on drape, silhouette, and fit
- Background: either pure neutral (white/light gray) or consistently blurred same scene
- **Pose consistency:** Model standing naturally, arms relaxed or slightly away from body (garment visible)

#### Shoes
- 3/4 angle, left foot forward (consistent for all shoes)
- Sole visible
- No extreme perspective distortion

#### Accessories
- Centered, no background clutter
- Scale reference if small (e.g., scarf on a hanger — but only if consistent)

### 1.3 Lighting & Color

- **Lighting:** Softbox from upper-left at 45°, no mixed light sources
- **Color temperature:** Daylight 5500K or corrected white balance in post
- **Color accuracy:** Product must match real-world color within ≈5% (critical for fashion)
- **No watermarks, logos, or text overlays** on primary product images
- **Resolution:** Minimum 1200px on shortest edge; 2000px recommended for zoom capability

### 1.4 PDP Image Gallery Order

Each product should have at minimum:

```
[1] Primary — 4:5 model shot or 1:1 flat lay (best representation)
[2] Detail — fabric texture, stitching, hardware close-up (1:1)
[3] Fit/drape — different angle or pose (4:5 or 1:1)
[4] Scale/context — flat lay with styling props (optional, 1:1)
```

---

## 2. Empty State Illustration Standards

### 2.1 Style Rules

All empty state SVGs must share:

| Property           | Value                                  |
|--------------------|----------------------------------------|
| **Stroke weight**  | 2.5px primary, 2px secondary elements  |
| **Primary color**  | `--brand-primary` = `#B08D57`          |
| **Strong accent**  | `--brand-primary-strong` = `#96754A`   |
| **Ink (dark)**     | `--ink-900` = `#1E2A38`                |
| **Fill tone**      | Warm Ivory at 40–60% opacity           |
| **Stroke style**   | `round` linecap and linejoin           |
| **ViewBox**        | Standardize on `0 0 240 200`           |
| **Line art only**  | No filled shapes (except subtle bg fill) |

### 2.2 Available Empty State SVGs

| File                                    | Used For             | Visual Theme            |
|-----------------------------------------|----------------------|-------------------------|
| `/images/empty-states/empty-cart.svg`   | Cart, no-products    | Open bag + "0" badge    |
| `/images/empty-states/empty-wishlist.svg`| Wishlist, no-reviews | Heart + sparkles        |
| `/images/empty-states/empty-search.svg` | Search results       | Magnifier + shirt hint  |

### 2.3 Empty State Copy Tone

| State               | Title Suggestion                | Body Suggestion                              |
|---------------------|----------------------------------|----------------------------------------------|
| Empty cart          | "Your cart is empty"            | "Browse our shop and add an item to get started." |
| Empty wishlist      | "No wishlists yet"              | "Create your first wishlist and save your favorites." |
| Empty search        | "No results found"              | "Try a different search term or browse by category." |
| No reviews          | "Be the first to review"        | "Share your thoughts and help others shop with confidence." |
| Out of stock        | "This one's gone"               | "Explore similar styles while you wait." |

---

## 3. Empty State SVG Illustration Starters

### 3.1 Empty Cart — Tote/Sparkle

A minimal open tote with a small sparkle accent, using the brand palette.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" aria-hidden="true" focusable="false">
  <title>Empty cart illustration</title>
  <!-- Tote bag body -->
  <path d="M48 70 L40 160 L200 160 L192 70 Z"
        fill="none" stroke="#1E2A38" stroke-width="4" stroke-linejoin="round"/>
  <!-- Tote opening -->
  <path d="M48 70 L120 60 L192 70"
        fill="none" stroke="#1E2A38" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- Handle -->
  <path d="M100 60 Q120 32 140 60"
        fill="none" stroke="#B08D57" stroke-width="4" stroke-linecap="round"/>
  <!-- Sparkle accent -->
  <g fill="#C9A76B">
    <path d="M168 92 l4 12 12 4 -12 4 -4 12 -4 -12 -12 -4 12 -4 z"/>
  </g>
</svg>
```

**Notes:**
- The "sparkle" is optional; remove it for a more minimal look.
- If your grid is very tight, use only the tote outline and drop the sparkle.

### 3.2 Empty Wishlist — Heart + Soft Glow

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" aria-hidden="true" focusable="false">
  <title>Empty wishlist illustration</title>
  <!-- Heart outline -->
  <path d="M120 150
           C 78 118, 60 88, 80 62
           C 95 44, 115 40, 120 58
           C 125 40, 145 44, 160 62
           C 180 88, 162 118, 120 150 Z"
        fill="none" stroke="#1E2A38" stroke-width="4" stroke-linejoin="round"/>
  <!-- Soft glow behind heart -->
  <path d="M120 150
           C 78 118, 60 88, 80 62
           C 95 44, 115 40, 120 58
           C 125 40, 145 44, 160 62
           C 180 88, 162 118, 120 150 Z"
        fill="#C9A76B" opacity="0.18"/>
</svg>
```

**Notes:**
- Keep the glow subtle; it should feel like a whisper, not a spotlight.
- For a more editorial feel, you can offset the heart slightly left and leave more right-side room for text.

### 3.3 No Search Results — Magnifier + Garment

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" aria-hidden="true" focusable="false">
  <title>No search results illustration</title>
  <!-- Magnifier handle -->
  <line x1="120" y1="120" x2="170" y2="170"
        stroke="#1E2A38" stroke-width="6" stroke-linecap="round"/>
  <!-- Magnifier rim -->
  <circle cx="110" cy="108" r="38"
          fill="none" stroke="#1E2A38" stroke-width="4"/>
  <!-- Inner garment hint (simplified shirt) -->
  <g opacity="0.55">
    <path d="M92 96 L92 124 L110 138 L120 124 L128 138 L146 124 L146 96 Z"
          fill="none" stroke="#B08D57" stroke-width="3" stroke-linejoin="round"/>
    <line x1="92" y1="112" x2="146" y2="112"
          stroke="#B08D57" stroke-width="3"/>
  </g>
</svg>
```

**Notes:**
- The inner garment is intentionally simplified — it reads as "apparel" without committing to a specific item.
- If you have a specific search category focus (e.g., dresses only), swap the garment hint for a more specific silhouette.

### 3.4 No Reviews — Speech Bubble + Star

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" aria-hidden="true" focusable="false">
  <title>No reviews illustration</title>
  <!-- Bubble -->
  <path d="M60 60 H180 V110 H60 Z
           M60 60 L48 48
           M60 60 L48 72"
        fill="none" stroke="#1E2A38" stroke-width="4" stroke-linejoin="round"/>
  <!-- Single star -->
  <g fill="#C9A76B">
    <path d="M120 92 L124 100 L133 100 L126 106 L129 115 L120 110 L111 115 L114 106 L107 100 L116 100 Z"/>
  </g>
</svg>
```

**Notes:**
- A single star keeps the illustration airy and never implies a rating.
- For a more conversational feel, you can add a small quotation mark in the brand accent.

---
## 4. SVG Construction Rules

- ViewBox: `0 0 240 200` (wide enough to leave room for text beside or below).
- Stroke-based line art where possible; avoid heavy fills.
- Max three colors: one primary brand tone, one neutral, one accent.
- All strokes ≥ 2px at the base size; scale proportionally.
- Include `aria-hidden="true"` and a meaningful `alt` on the parent `<img>` or `<svg>` as appropriate.

### 4.1 Sizing & Placement
- Desktop: illustration ~96–120px wide, centered, above the headline.
- Tablet: ~80–96px.
- Mobile: ~64–80px, full-width container, text below the illustration.
- Maintain consistent vertical rhythm: illustration → headline → body → CTA, with consistent spacing tokens.

---

## 5. Hero Banner Layout Strategy

### 5.1 Goals
The hero must do two things simultaneously:
1. Create a strong first impression (image quality, mood, brand feel).
2. Keep headline text readable on every screen without relying on "just make the text bigger."

The tension is real — fashion imagery is often busy, high-contrast, or dark. The layout must be robust against that.

### 5.2 Three-Layer Architecture

Think of the hero as three stacked layers, back to front:

1. **Image layer** — full-bleed, aspect-ratio locked, `object-fit: cover`.
2. **Overlay layer (recommended)** — a gradient or tint that guarantees text contrast regardless of the image content behind it.
3. **Content layer** — headline, subhead, CTA, and any trust badges.

This layering keeps the image visually dominant while insulating the text from the image's content.

### 5.3 Aspect Ratio Strategy

| Screen | Recommended hero ratio | Rationale |
|---|---|---|
| Desktop | 16:9 or wider (e.g., 2560×1440 crop) | Wide canvas; text can sit left or center with room for a visual on the right. |
| Tablet | 4:3 to 16:9 | Compromise — enough height for a mood shot, enough width for text. |
| Mobile | 3:4 to 1:1 (often shorter, ~180–260px tall) | Orientation flips; text stacks above or below the image if needed. |

**Rule:** Never let the hero image's aspect ratio vary by device without a deliberate crop. The same image should be cropped per breakpoint, not just squashed.

### 5.4 Overlay Strategy for Readability

Overlays are the safest way to guarantee contrast. Use one of these patterns:

1. **Full-bleed gradient overlay**
   - Dark gradient at the bottom (or behind text zone), lighter at the top.
   - Good when the image is bright in some areas and dark in others.
   - Typical values: `linear-gradient(to bottom, rgba(0,0,0,0.25), rgba(0,0,0,0.70))`.

2. **Targeted dark panel behind text**
   - A semi-transparent box behind the headline/CTA only.
   - Useful when the image has a rich, colorful focal point you don't want to mute everywhere.
   - Typical values: `background: rgba(10,10,10,0.45); backdrop-filter: blur(2px)`.

3. **Tinted overlay + white text**
   - Uniform tint (e.g., 30–45% black) over the whole hero.
   - Best when the image already has a consistent tone (e.g., moody studio shot).

**Important:** Always verify contrast with a tool. Aim for at least WCAG AA for the headline; for body text, aim for stronger contrast if possible.

### 5.5 Text Hierarchy in Hero

Keep it tight. A strong hero usually has:

1. **Eyebrow / category label** (optional) — small caps, letter-spaced, brand accent.
2. **Headline** — the one thing people read. Keep it to one line on desktop, max two on mobile.
3. **Subhead (optional)** — one short line; often unnecessary if the headline is already clear.
4. **Primary CTA** — high-contrast button.
5. **Secondary CTA (optional)** — text link or ghost button.

**Guideline:** If you find yourself adding more than five text elements, the hero is probably trying to do too much.

### 5.6 Responsive Behavior

**Desktop:**
- Text can sit left-aligned with the image on the right, or centered for a more editorial look.
- If using a split layout (text left, image right), keep the image's focal point vertically centered to the headline.

**Tablet:**
- Simplify: consider centering text over a shorter hero, or moving the image above/below the text.
- If keeping side-by-side, reduce font sizes slightly and tighten margins.

**Mobile:**
- Stack: headline + CTA above the image, or image above text depending on the campaign priority.
- Keep headline to one line if possible; if two lines, ensure the second line is still clearly readable.
- Make the CTA large enough to tap comfortably (minimum ~44px tap target, ideally larger).

### 5.7 Safe-Zone & Cropping Rules

When preparing hero images:
- Keep the **most important visual subject** within a central safe zone (roughly the middle 60% of the frame).
- Avoid putting faces or key garment details at the extreme edges — they may be cropped on some screens.
- If the campaign depends on a specific visual (e.g., a model facing one direction), test the crop on all breakpoints before finalizing.
- For split desktop layouts, leave the left or right portion of the image relatively clean to avoid text colliding with busy areas.

### 5.8 CTA Readability in Hero

- Primary CTA should have a solid background or strong outline — never low-contrast text only.
- If the hero is dark, use a warm/light CTA; if the hero is light, use a darker CTA.
- Keep button text short: 2–4 words max.
- Button height in hero: ~48–64px on desktop, ~44–56px on mobile.

### 5.9 Motion (Optional but Useful)

If the hero uses a subtle animation (fade-in, slow zoom, parallax), keep it gentle and respect `prefers-reduced-motion`. The goal is polish, not distraction.

- **Fade-up headline:** 300–450ms, ease-out.
- **Image zoom:** very subtle, <5% scale, slow (6–10s), only if the image is static and the effect is tasteful.
- **Avoid:** heavy parallax that makes text drift relative to the image — this hurts readability.

### 5.10 Quick Checklist Before Launch

- [ ] Hero image cropped per breakpoint, not just resized.
- [ ] Text contrast checked on real backgrounds, not just gray-scale mockups.
- [ ] Headline reads comfortably at mobile font size.
- [ ] CTA is clearly tappable on mobile.
- [ ] No critical visual detail lives at the extreme edges of the hero image.
- [ ] Motion respects `prefers-reduced-motion`.
- [ ] If the hero includes a promo message, it remains readable when the overlay is applied.

---

## 6. Practical Workflow

### 6.1 For Product Photography
1. **Define the shot list** before the shoot: hero model shot, flat lay for grid, detail shots.
2. **Lock the aspect ratios** per shot type and communicate them to the photographer/editor.
3. **Set the background standard** (color, texture, lighting) and keep it consistent across the collection.
4. **Edit for consistency**, not just individual beauty — exposure, white balance, and contrast should match across all products in a category.
5. **Export in the required sizes** with the correct aspect ratios, not larger images that get cropped inconsistently later.

### 6.2 For Empty State Illustrations
1. **Pick one visual concept per state** and stick to it across the site.
2. **Build as SVG**, not PNG, so they scale cleanly.
3. **Limit palette** to existing brand tones.
4. **Pair each illustration with copy** that is helpful, not cute — users should know what to do next.
5. **Test on mobile** to ensure the illustration doesn't dominate the screen or get lost.

### 6.3 For Hero Banners
1. **Start from the message**, not the image. What should the user feel and do?
2. **Choose an image that supports the message** without competing with the text.
3. **Apply an overlay strategy** that guarantees readability before you style the text.
4. **Set the text hierarchy** and keep it short.
5. **Check all breakpoints**, especially mobile, before approving the campaign.

---

## 7. Asset Folder Structure

```
public/
├── images/
│   ├── products/            # Product photography (JPEG, WebP)
│   │   └── *.jpg / *.webp
│   ├── empty-states/        # SVG empty state illustrations
│   │   ├── empty-cart.svg
│   │   ├── empty-wishlist.svg
│   │   └── empty-search.svg
│   └── hero/                # Hero banner images (high-res)
│       └── *.jpg / *.webp
└── styles.css               # Global design system tokens
```

---

## 8. Quick Reference Card

**Photo ratios:**
> Flat lay → **1:1** · Model full-body → **4:5** · PDP main → **4:5** · Card thumbnail → **3:4** · Detail → **1:1**

**Empty state SVGs:**
> Cart → `empty-cart.svg` · Wishlist → `empty-wishlist.svg` · Search → `empty-search.svg`

**Hero overlay:**
> Dark gradient 30–60% desktop, 45–70% mobile · White text · Brass CTA button · NO text baked into image

**Grid uniformity checks:**
- [ ] Same aspect ratio across all products in a category
- [ ] Same resolution (2000px longest edge recommended)
- [ ] Same background treatment
- [ ] Same lighting direction and intensity
- [ ] No mixed lighting
- [ ] Consistent white balance
- [ ] No logos/watermarks/text baked in
- [ ] Filename convention: `{product-slug}-{view}.jpg`
