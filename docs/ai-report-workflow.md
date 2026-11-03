# AI report editing and local history

Reports retain the existing nine report templates and explicit outgoing-data preview. Provider calls are direct; this feature does not introduce a proxy or server-side academic storage.

## Workflow

1. Select the group, date range, student and subject as needed.
2. Preview and approve the outgoing structured data. Privacy protection remains enabled by default.
3. Generate a draft, review its title and body, and save a version locally.
4. Reopen previous versions from the selected group's history. Each explicit save inserts a new immutable snapshot; it does not overwrite another tab's version.
5. Download edited text as TXT, escaped printable HTML, native Word (`.docx`), OpenDocument Text (`.odt`) or a directly generated PDF. Downloads do not implicitly save a history version.

Saved versions include the local group/year/period context, provider, model and timestamp, but not API credentials or the source dataset. Names hidden in outgoing data remain hidden in the generated body; the interface does not automatically reconstruct identities.

## Safeguards and limits

- Navigating away from unsaved edits triggers the existing guard; closing the editor asks before discarding. Unsaved report edits are not recoverable after a forced browser termination.
- Cancellation aborts the client request and suppresses late results. It cannot retract data already sent or guarantee cancellation of provider-side work or charges.
- More than 650 data rows or 60,000 CSV characters blocks generation and requests narrower filters; no rows are silently discarded. This conservative limit is not a guarantee of fitting every model's context window.
- Output requests allow up to 4,000 tokens. Provider-reported length termination is visibly retained in the report context as a warning.
- HTML output escapes both teacher and model text. Generated HTML or scripts are never executed as report content.
- Word and ODT export editable paragraphs, title and context in A4 layout. PDF embeds the locally served Noto Sans font, wraps long words and paginates text. Unsupported PDF glyphs produce an explicit error with Word/ODT as alternatives, rather than silently replacing characters. Export libraries load dynamically; no document content is uploaded for conversion.
- Database version 7 adds `aiReports`. New backups include all saved versions; the validator accepts older backups without this table as an empty history and validates new rows. Restoring an older backup therefore replaces current history as part of the complete database restore.
- Deleting a version requires confirmation. Other versions are retained.

Automated checks use fictional data and simulated provider responses. They test transport cancellation, truncation flags, archive validation, HTML escaping, editing/version persistence, printable download, and encrypted backup restoration. They do not establish pedagogical quality across real providers; teacher review remains required.

## Native export implementation and QA

The native-format extension uses [docx](https://docx.js.org/api/classes/Packer.html) for browser-side OOXML packaging, [fflate](https://github.com/101arrowz/fflate) for the ODT ZIP, and [pdf-lib](https://pdf-lib.js.org/) with fontkit for PDF layout and embedding. The Noto Sans font is distributed with its [SIL Open Font License](https://github.com/notofonts/noto-fonts/blob/main/LICENSE) in `public/fonts/NotoSans-LICENSE.txt`.

Tests verify editable accented text, XML escaping, package signatures, the uncompressed first ODT mimetype entry, A4 layout, multi-page PDF generation, long-word wrapping, invalid input and font-download failures. Browser coverage verifies all three actual downloads contain edited text and make no external HTTP requests; downloads do not create an archive version. Fictional Word/ODT packages were parsed as XML, and all pages of the two-page PDF fixture were rendered and visually inspected. This is not a native Microsoft Word or LibreOffice visual compatibility certification.


See [CI and security](ci-and-security.md) for current verification commands. The fontkit export dependency is large and loads on demand; old release test counts do not describe current validation.
