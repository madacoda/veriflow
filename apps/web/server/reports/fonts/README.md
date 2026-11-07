# Embedded report font

Noto Sans Regular is distributed under the SIL Open Font License 1.1 in [OFL.txt](OFL.txt). The base64 in `noto-sans.ts` is the unmodified TTF from the archived [Noto fonts repository](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf).

TTF SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.

The renderer embeds only used glyphs. Supported Latin, Greek and Cyrillic characters render directly; unsupported characters appear as explicit `[U+XXXX]` code points with a note in the report. No network fetch or runtime filesystem read is required.
