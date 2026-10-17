## Reference

- development docs: @docs/dev.md
- coding standard: @docs/CODING_STANDARDS.md

## First version

- Python package: `image_create_tool`. GUI, service and renderer are separate modules in one process.
- Use the workspace `.venv/Scripts/python.exe`. Run `-m image_create_tool open --project <workdir>` for GUI, `render --project <workdir> --output <png>` for headless production rendering.
- Edit only the work directory's `pjt.json`. Required marker: `image-create-tool-version: "v0.0.1"`. Default directories: `assets/`, `outputs/`.
- Material names can be supplied with `assetQuery: {"name": "芈月"}`. Run `assets search --project <workdir> --name <name>` rather than manually searching absolute paths.
- Supported elements: `text`, `image`, `rect`, `group`, `itemRow`. Use stable IDs; `itemRow` has separately editable `:text` and `:image` child IDs.
- Do not add strategic recommendations or change the user's decisions without an explicit request. Preserve original notes in `sourceNotes`.
- Verify with `validate`, then `render`. Missing assets, invalid crop, font errors and content overflow block final export.
- Acceptance workdir is `tool_test/`; use the copied resources there, and use old project images only as reference. Never run the old rendering script as the new application test.


## Rules

- Do **NOT** write test code until User ask for this.


## todo

制作模板用于后续使用