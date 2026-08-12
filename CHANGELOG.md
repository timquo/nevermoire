# Changelog

All notable changes to Nevermoire are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-12

### Added

- Local tiled FFT detector with robust radial spectral whitening.
- Symmetric peak detection and neighbouring-tile coherence scoring.
- Adaptive Gaussian notch filtering for chroma and optional luminance.
- Weighted overlap-add reconstruction without hard tile seams.
- Edge, activity, and confidence-based spatial blending.
- Luminance-guided classical chroma smoothing.
- Luminance/chroma frequency matching to protect genuine periodic texture.
- `auto`, `screen`, `fabric`, and `chroma-only` modes.
- Configurable analysed frequency range and luminance-notch attenuation.
- Confidence-mask and portable JSON diagnostics.
- JPEG, PNG, WebP, and TIFF input/output.
- Resource limits, input-signature validation, and overwrite protection.
- Metadata-free output for privacy.
- Cross-platform CI, Dependabot, secret scanning, and 17 automated tests.
- Redistributable original/balanced/strong documentation example, attributed
  to David Clode and used under the Unsplash License.

### Security

- Production dependencies audited with zero known npm vulnerabilities at
  release preparation time.
- GitHub Actions pinned to immutable commit SHAs.
- Diagnostics exclude absolute filesystem paths.
- Inputs are limited to 8 million decoded pixels by default and 30 million only
  when explicitly requested.
