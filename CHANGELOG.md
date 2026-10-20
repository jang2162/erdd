# Changelog

All notable changes to the ERDD npm packages, `@erdd/cli` and `@erdd/core`, are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions follow `@erdd/cli`, and each
release is tagged `cli-v<version>`. Releases before this file was started are listed on the
[GitHub tags page](https://github.com/jang2162/erdd/tags).

## [Unreleased]

## [0.7.0] - 2026-10-20

### Added

- English user manuals in `docs/manual/en/`. English is now the source language, and the Korean manuals
  in `docs/manual/ko/` are translations.
- `@erdd/cli` and `@erdd/core` ship a Korean README as `README.ko.md` next to the English `README.md`.

### Changed

- `@erdd/cli` bundles the manuals in one folder per language: `docs/en/` and `docs/ko/`. The bundled
  manuals were previously at the top level of `docs/`.
- The `@erdd/cli` and `@erdd/core` package READMEs and npm descriptions are now in English.

[Unreleased]: https://github.com/jang2162/erdd/compare/cli-v0.7.0...HEAD
[0.7.0]: https://github.com/jang2162/erdd/compare/cli-v0.6.0...cli-v0.7.0
