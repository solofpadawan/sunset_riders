# Netplay UI translations (i18next)

Files: `../lib/i18next.min.js` (i18next 27.0.1, vendored, no CDN), `en.js`, `pt.js`, `init.js`.
Loaded in index.html before romload.js and the net/ scripts. Code calls `t('key')` (global, also `SSRI18N.t`).

Language: `?lang=xx` (pt* -> pt), then `navigator.languages`, then fallback `en`.

## Adding a language
1. Copy `en.js` to e.g. `es.js` and change `G.SSRI18N_RESOURCES.en` to `.es`; translate every value, keep the keys.
2. Add `<script src="i18n/es.js"></script>` before `init.js` in index.html.
3. Nothing else: `init.js` picks any loaded language from `?lang=` or `navigator.languages` (`xx-YY` -> `xx`).
Values may contain HTML (`escapeValue: false`): keep only trusted catalogue text there.
