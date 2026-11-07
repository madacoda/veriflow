# UI foundation

Use the checked-in shadcn/ui Radix Nova components configured in `apps/web/components.json`. Add components with `bun run --cwd apps/web shadcn add <component>` and commit their explicit runtime dependencies and the Bun lockfile. Components are application-owned source, not a parallel custom widget library.

The palette in `app/globals.css` is the [Amber Minimal registry preset](https://tweakcn.com/r/themes/amber-minimal.json). Inter is self-hosted through `@fontsource-variable/inter`; no font service is needed at runtime. Use semantic CSS variables rather than introducing another brand palette. Outcome colors remain distinct so passed, failed and blocked results are readable independently of the amber brand color.

- Use `Button` with the default variant for form submission and `outline` for supporting actions. Preserve explicit button types inside forms.
- Use `Input`, `Textarea`, `Label` and `Checkbox` for forms. Checkbox values must preserve native form submission and controlled state behavior.
- `NativeSelect` intentionally preserves existing native selection, form serialization and keyboard behavior. It is the shadcn native-select component, not a custom dropdown.
- Use `Badge` for status labels, retaining readable status text in addition to color.
- `primitives.tsx` adapts the registry Card/Input spacing to the existing workbench layout. Feature CSS owns layout, while registry components own control appearance and variants.

The checkbox checked-state selectors use Radix's `data-state="checked"` attribute. Preserve that adapter when refreshing registry source.
