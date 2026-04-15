# Change Log

## [0.1.2] - 2026-04-15

### Changed
- Custom editor no longer activates on `*.zip` files — GDTF files only

## [0.1.1] - 2026-04-15

### Added
- Extension icon (lightbulb)
- Screenshot in README for Marketplace listing

## [0.1.0] - 2026-04-15

### Added
- **Edit & save back**: extracted files can be edited and saved back into the `.gdtf` archive via a prompt on Ctrl+S
- GDTF schema validation of `description.xml` via `xmllint` with Problems panel integration
- Hover documentation for XML elements in `description.xml`
- Document symbol provider (Outline view) for `description.xml`
- Inline CIE xyY colour swatches on `<Slot>` elements
- Wheel media and fixture thumbnail hover previews
- Isometric cuboid preview for `<Model>` elements
- Grouped file view (Description / Thumbnails / Wheel Media / 3D Models / Other)
- GDTF metadata card (fixture name, manufacturer, UUID, GDTF version, DMX modes, revisions, RDM, connectors)
- Bundled `gdtf.xsd` schema for offline validation

### Changed

- Repository: https://github.com/hippyau/vscode-gdtf-editor
