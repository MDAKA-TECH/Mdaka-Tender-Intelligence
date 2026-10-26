---
name: Tender Intelligence
description: The company's bid file. Navy binder spine, bond-paper ground, white sheets, and index-divider colours that always mean the same thing.
colors:
  spine: "#1a2a5e"
  spine-hi: "#233670"
  spine-ink: "#c9d3f0"
  spine-line: "#2c3f7c"
  ground: "#edf0f6"
  sheet: "#ffffff"
  sunken: "#f3f5f9"
  ink: "#131a2a"
  ink-2: "#2e3850"
  muted: "#5a6478"
  line: "#dfe3ec"
  line-strong: "#c4cbda"
  cobalt: "#2a52cf"
  cobalt-ink: "#1f43b0"
  cobalt-soft: "#e2e9fd"
  review: "#f2b400"
  review-on: "#2b2000"
  review-ink: "#7a5300"
  review-soft: "#fdf2cf"
  ready: "#13805a"
  ready-ink: "#0d6545"
  ready-soft: "#dcf2e7"
  crit: "#c9361f"
  crit-ink: "#a6290f"
  crit-soft: "#fde5df"
  violet: "#6a43cf"
  violet-ink: "#5230b0"
  violet-soft: "#ece6fc"
  slate: "#687388"
  slate-ink: "#4a5366"
  slate-soft: "#e7eaf0"
  on-tone: "#ffffff"
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "38px"
    fontWeight: 760
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 80"
    fontFeature: "'tnum'"
  headline:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 720
    lineHeight: 1.15
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 88"
  title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 660
    lineHeight: 1.3
    fontVariation: "'wdth' 94"
  body:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  label-tab:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
    letterSpacing: "0.05em"
    fontVariation: "'wdth' 82"
  label-field:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 580
  source-text:
    fontFamily: "ui-monospace, 'Cascadia Mono', 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "12.5px"
    lineHeight: 1.6
rounded:
  tag: "4px"
  sm: "7px"
  nav: "8px"
  md: "10px"
  modal: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-tone}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-ink}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
  button-ghost:
    textColor: "{colors.cobalt-ink}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    height: "30px"
  button-ghost-hover:
    backgroundColor: "{colors.cobalt-soft}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
    height: "38px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.md}"
    padding: "20px"
  rail:
    backgroundColor: "{colors.spine}"
    textColor: "{colors.spine-ink}"
    width: "248px"
  nav-item-current:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.nav}"
    padding: "10px 14px"
  status-tab:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-tone}"
    typography: "{typography.label-tab}"
    padding: "3px 10px 2px"
  divider-tab:
    backgroundColor: "{colors.review-soft}"
    textColor: "{colors.review-ink}"
    typography: "{typography.label-tab}"
    padding: "9px 15px 8px"
  divider-tab-selected:
    backgroundColor: "{colors.review}"
    textColor: "{colors.review-on}"
  pill:
    backgroundColor: "{colors.slate-soft}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.pill}"
    padding: "1px 9px"
  toast:
    backgroundColor: "{colors.spine}"
    textColor: "{colors.on-tone}"
    rounded: "{rounded.nav}"
    padding: "11px 16px"
---

# Design System: Tender Intelligence

## Overview

**Creative North Star: "The Bid File"**

The app is the company's own lever-arch bid file. A navy binder spine runs down the left as navigation, the page is cool bright bond paper, and every working surface is a white sheet with a hairline edge. Meaning comes from binder index dividers: each status and each checklist section owns one fixed divider colour, shown as a tab, so the user knows where they are by colour before reading a word.

The palette is a closed set of six divider colours plus navy and paper neutrals. Colour is only used to carry meaning. Typography is one variable family, Archivo. Condensed bold weights set headings and caps tab labels, and every date, count and countdown uses tabular figures. The density is calm and roomy for long desk sessions. It gets tighter only in lists that need scanning: the tender table, the coming-up strip, and requirement lists.

This is compliance work, so the system rejects the grey SaaS screen with one teal accent, cream or warm paper, decorative gradients and glow, and playful illustration. Light and dark modes share every role. Dark mode swaps the values, never the meaning.

**Key Characteristics:**
- A navy spine rail with a white spine-label card for the product name. The current page's nav item opens into the paper ground, like a tab pulled out of the binder.
- Six divider colours with fixed meanings, applied through a single tone hook (fill, text-on-fill, soft tint, text-on-tint).
- Index-divider tabs: top-rounded tabs in condensed caps sitting on a 3px rule in the selected tab's colour.
- White sheets on a blue-white ground with soft, low, diffuse shadows.
- Tabular figures for every date, count and countdown. Deadlines are the loudest type on the screen.
- Lucide line icons at 17px with a 1.9 stroke.

## Colors

A cool, paper-and-navy neutral base, with six saturated index-divider colours that are reserved for meaning.

### Primary
- **Binder Navy** (spine): the navigation rail, the login backdrop and the toast. It is the binding of the file and never fills content.
- **Cobalt Divider** (cobalt): the primary action (one solid cobalt button per view), the "preparing" status, links (cobalt-ink), the focus ring, and the "Key facts" section.

### Secondary: the divider set
Each divider has four roles: a fill, text on the fill, a soft tint, and text on the tint.
- **Marigold** (review): to review, expiring, warnings. Its on-fill text is dark (review-on), never white.
- **Emerald** (ready): prepared, ready, valid, won, and checklist ticks (the checkbox accent colour and the progress meter).
- **Vermilion** (crit): disqualification, expired, missing, and destructive actions.
- **Violet** (violet): submitted, and "Other requirements".
- **Slate** (slate): closed, lost, not bidding, and not uploaded.

### Neutral
- **Bond Paper** (ground): the page ground. It is blue-white, never cream.
- **Sheet White** (sheet): panels, modals, inputs and lists.
- **Sunken Paper** (sunken): table header rows, row hover, source-text wells and file-pick wells.
- **File Ink** (ink), **Ink Secondary** (ink-2), **Muted** (muted): primary text, field labels and secondary values, and meta text and placeholders.
- **Hairline** (line) and **Strong Hairline** (line-strong): sheet edges and row rules, and control borders plus the idle divider rule.
- **Spine tints** (spine-hi, spine-ink, spine-line): rail hover, rail text, and the rail separator.

Dark mode is a full token swap on `:root`, applied by `prefers-color-scheme` or `[data-theme='dark']`. The ground becomes near-black navy (#0d111d) and the sheets become #151a29. Divider fills lighten and their on-fill text turns dark. The swap lives in the stylesheet, and no component restates it.

### Named Rules
**The Fixed Divider Rule.** A divider colour means one thing everywhere. Reviewing is marigold, preparing is cobalt, submitted is violet, won is emerald, and lost or not bidding is slate. The status-to-tone map in the code is the single source. Never pick a tone for looks.

**The Tone Hook Rule.** Coloured components take their colour from `data-tone` (review, ready, crit, cobalt, violet, slate), which sets the fill, on-fill, soft and ink roles. They never take a hex value or a one-off class.

**The One Cobalt Button Rule.** Each view has one solid cobalt button, for its primary action. All other buttons are white sheets with a strong hairline, or ghost text.

## Typography

**UI Font:** Archivo Variable, using the width axis (fallback: Archivo, system-ui, Segoe UI)
**Source-text Font:** system monospace (ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas), used only for raw extracted PDF text in the viewer.

**Character:** A single grotesque family that works by stretching. Semi-condensed bold for headings, condensed caps for tab labels, and normal width for reading. The result feels like printed office stationery, not a startup.

### Hierarchy
- **Display** (760, 38px, line-height 1, width 80%, tabular figures): only the closing countdown in the deadline band ("7 days left"), in the closing tone's ink colour.
- **Headline** (720, 27px, 1.15, width 88%, -0.015em; 23px under 640px): page titles.
- **Title** (660, 16px, 1.3, width 94%): sheet headings.
- **Figure** (700, 21–24px, width 86%, tabular figures): deadline-band values and checklist summary counts.
- **Body** (400, 14.5px, 1.5): everything else. Intro text is capped at 64ch.
- **Field label** (580, 13px, ink-2): labels above inputs, and the deadline-band labels (12.5px, muted).
- **Tab label** (680–700, 11.5–13px, width 80–82%, 0.05em tracking, UPPERCASE): divider tabs, status tabs, divider labels and table column heads (650, 11.5px, muted).

### Named Rules
**The Tabular Figures Rule.** Every date, time, count and countdown uses tabular figures, so deadline columns line up.

**The Caps Belong to Tabs Rule.** Uppercase, condensed, tracked type is reserved for things that are tabs or column heads. Headings and body text stay in sentence case.

## Layout

The shell is a two-column grid: a 248px spine rail, then a scrolling main area. Pages are capped at 1280px with 32px top and 64px bottom padding. Side padding is 40px at 860px and wider, and 16px below that (respecting safe-area insets). Within a page, sheets stack with a 24px gap. The tender detail page uses a 1.9fr main column and a side column of at least 300px, collapsing to a single column at 1080px and below.

Spacing rhythm: 4/8px within controls, 16–20px sheet padding (16px under 640px), and 24px between sheets and columns.

Responsive behaviour:
- **860px and below:** the rail becomes a top band. The brand card shrinks and the nav turns into a horizontally scrolling row of top-rounded tabs with short labels.
- **1080px and below:** the deadline band reflows so the closing cell spans the full width above the other three.
- **640px and below:** the tender table becomes stacked grid rows (tender and status, then closing, then issuer and checklist). Divider tab rows scroll horizontally with a fade mask on the right edge.
- **520px and below:** the deadline band becomes a single column.

## Elevation & Depth

The system is tonal, with a light physical layer. Sheets sit on the ground with a hairline edge and a soft, low, diffuse two-part shadow. Modals and the toast use a deeper version of the same shadow. Depth beyond that comes from tone: sunken paper for headers, wells and hover, and divider tints for state.

### Shadow Vocabulary
- **Sheet** (`box-shadow: 0 1px 2px rgb(19 26 42 / 0.05), 0 6px 16px -6px rgb(19 26 42 / 0.08)`): every panel.
- **Lifted** (`box-shadow: 0 4px 10px rgb(19 26 42 / 0.08), 0 24px 56px -12px rgb(19 26 42 / 0.28)`): modals, the toast and the login card.
- **Spine label** (`box-shadow: inset 0 0 0 1px rgb(19 26 42 / 0.1), 0 2px 6px rgb(0 0 0 / 0.22)`): only the product-name card on the rail.
- **Focus halo** (`box-shadow: 0 0 0 3px var(--cobalt-soft)`): focused inputs and selects.

### Named Rules
**The Soft Offset Rule.** Shadows are diffuse and tinted with ink. This is not a neobrutalist world, so it never uses hard offset shadows or zero-blur slabs.

## Shapes

Corners are gently rounded: 10px on sheets, 7px on controls, 12px on modals, and 4px on requirement tags. Tabs are the signature form. Divider tabs are rounded only on top (8px 8px 0 0) and sit on a straight 3px rule. Status tabs are printed index tabs, slightly rounded on top and nearly square at the bottom (6px 6px 2px 2px). A list headed by a divider label loses its top corners and takes a 3px top rule in its tone, so the tab and the sheet read as one piece. Pills are fully rounded (999px) and start with a 6px dot. The current nav item is rounded only on the left (8px 0 0 8px), so it merges into the paper.

## Components

### Buttons
Quiet stationery, with one confident cobalt.
- **Shape:** gently rounded (7px), minimum height 36px, padding 7px 14px, weight 580, icon gap 7px.
- **Primary:** solid cobalt with white text and a 1px ink shadow. On hover it deepens to cobalt-ink.
- **Secondary (default):** a white sheet with a strong hairline border. On hover it turns sunken with a muted border.
- **Ghost:** cobalt-ink text with no border, 30px tall, and a cobalt-soft fill on hover. Used for Close, Back and inline actions.
- **Danger:** a secondary button with vermilion-ink text that tints vermilion-soft on hover.
- **Rail:** transparent with a spine-line border, used on the navy spine.
- **Focus / Disabled:** a 2px cobalt outline offset by 2px. Disabled buttons drop to 50% opacity.

### Status tab (index tab)
An uppercase condensed label printed as an index tab in its full divider colour, with 6px 6px 2px 2px corners. It marks tender status at the end of each tender row, next to the detail page title (in a larger 12.5px variant), and vault expiry states. The soft variant (tint fill, ink text) is for non-urgent absences such as "Not uploaded".

### Divider tabs (signature)
A row of top-rounded tabs (8px 8px 0 0) on a 3px rule that takes the selected tab's colour. Idle tabs show their tone's soft tint and ink and sit 2px low. Hover and selection raise them flush, and the selected tab fills solid with its tone. Count badges are translucent white capsules. These tabs filter tender status, filter vault state, and switch between Review and Checklist. Motion: the tab lift and colour change take 160ms, and the rule colour changes over 220ms with `cubic-bezier(0.16, 1, 0.3, 1)`.

### Divider label
A section heading set as a solid divider tab (7px 7px 0 0, 12.5px condensed caps, with an optional count). It sits on a list that carries a 3px top rule in the same tone: "To review" (marigold), "Documents to submit" (emerald), "Avoid disqualification" (vermilion), "Other requirements" (violet) and "Key facts" (cobalt).

### Deadline band
A full-width sheet split into four cells: Closing, Briefing, Submission and Checklist. The Closing cell is wider, takes its tone's soft tint, and shows the countdown in display type. The other cells use 17–21px figure type over a muted label with an icon. A closed-but-active tender shows its warning in the closing cell.

### Pills
Fully rounded, 12px at weight 620, with a 6px dot in the current text colour. They state facts and confidence: days left, AI confidence (high is emerald, medium cobalt, low marigold), "Quote not found" (vermilion) and "Keyword check" (marigold). In the coming-up strip they take the index-tab shape and drop the dot.

### Cards / Containers (sheets)
- **Corner Style:** 10px.
- **Background:** sheet white, with a hairline border and the Sheet shadow.
- **Header / body / footer:** 16px 20px header and 20px body padding, divided by hairlines.
- **Lists inside sheets:** rows separated by hairlines, with sunken hover on clickable rows. Requirement rows that need attention get a marigold-soft wash, and ticked checklist rows get a faint emerald wash with struck-through muted text.

### Inputs / Fields
- **Style:** a white sheet with a strong hairline, 7px radius, 38px minimum height, padding 8px 11px. The label sits above at 13px/580 in ink-2.
- **Selects:** native appearance removed, with an SVG chevron at the right (10px inset, 16px). Every select shares this treatment.
- **Hover / Focus:** hover sets a muted border. Focus sets a cobalt border with a 3px cobalt-soft halo and no outline.
- **Checkbox:** 18px with an emerald accent.
- **File pick:** a dashed 1.5px strong-hairline well on sunken paper, with a cobalt border on hover.

### Navigation
The spine rail in navy, holding the white spine-label card ("Tender **Intelligence**", with "Intelligence" in cobalt) and a stack of icon-and-label buttons (10px 14px, weight 520). Hover is spine-hi with white text. The current item fills with the paper ground, ink text, a cobalt icon and weight 650, and extends to the rail's right edge. The user and sign-out block sits at the foot of the rail above a spine-line rule. On mobile, see Layout.

### Modal and toast
The modal is a 540px sheet (900px when it holds the text viewer) with a 12px radius and the Lifted shadow. It has a sticky header, a footer with right-aligned actions, and sits on a navy-tinted scrim (`rgb(10 15 34 / 0.5)`). The toast is a navy spine chip, fixed to the bottom right.

## Do's and Don'ts

### Do:
- **Do** take every coloured surface from the tone hook (`data-tone` = review / ready / crit / cobalt / violet / slate) and keep status-to-colour mapping in the single status-tone map.
- **Do** show status as a solid index tab and sections as divider labels sitting on a list with a matching 3px top rule.
- **Do** make deadlines and expiry the loudest elements: the countdown in display type, tinted with the closing tone.
- **Do** use tabular figures for every date, count and countdown, in en-ZA format.
- **Do** keep one solid cobalt button per view. Every other action is secondary or ghost.
- **Do** use Lucide line icons as inline SVG at 17px with a 1.9 stroke, coloured by the surrounding text.
- **Do** keep sheets white on a blue-white ground with a hairline edge and the soft Sheet shadow.
- **Do** keep dark mode a value swap of the same tokens.

### Don't:
- **Don't** use a divider colour for decoration, or use two colours for one meaning (for example, won in cobalt).
- **Don't** warm the ground to cream or ivory. The paper is cool blue-white.
- **Don't** add decorative gradients, glow or playful illustration. The only gradient is the functional fade mask on scrolling tab rows, and the only halo is the input focus ring.
- **Don't** use hard offset or zero-blur shadows.
- **Don't** set headings, body text or labels above headings in uppercase. Caps belong to tabs and column heads.
- **Don't** use emoji or glyph characters as icons.
