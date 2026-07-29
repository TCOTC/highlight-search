# Document Highlight Search

Find text in the currently open document and highlight all matches. Supports jumping to the previous / next match, and replacing the current match.

## How to open

- Click the button on the right side of the top bar
- Default shortcut `Ctrl+Shift+Alt+F` / `⌥⇧⌘F`: open search
- Default shortcut `Ctrl+Shift+Alt+R` / `⌥⇧⌘R`: open find and replace
- These shortcuts can be changed in Keymap settings

You can also bind custom shortcuts for Previous, Next, and Replace Current.

## Features

- Case-sensitive search and whole-word matching
- Results list panel; browse hits in document reading order
- Replace the current match, with optional preserve-case
- For replace-all, continue using SiYuan’s built-in `Ctrl+R` / `⌘R`

## Scope

Searches only the body text of the current tab’s document — not UI chrome or the document title. Replace applies only to visible text on the whitelist (e.g. ordinary paragraphs, list items). In non-replaceable contexts such as formulas or charts, the replace button is disabled.
