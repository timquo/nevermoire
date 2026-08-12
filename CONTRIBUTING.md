# Contributing to Nevermoire

Contributions are welcome, especially reproducible real-world moire examples,
negative examples containing legitimate periodic texture, detector improvements,
and performance work.

## Development setup

Clone the repository, then run:

```sh
npm install
npm test
```

Node.js 20 or newer is required. `sharp` is the only runtime dependency.

## Before submitting a change

1. Keep processing local and deterministic. Do not add telemetry, network calls,
   neural models, or model downloads.
2. Add or update tests for numerical and CLI behaviour.
3. Run `npm run check` and `npm audit --omit=dev`.
4. Do not commit private photographs without explicit permission. Strip EXIF,
   XMP, IPTC, GPS, comments, and device identifiers from test assets.
5. Do not commit credentials, `.env` files, diagnostics containing absolute
   paths, or large generated directories.
6. Explain visual trade-offs. Removing more moire is not automatically better
   if genuine texture is damaged.

## Test images

Small synthetic fixtures are preferred. When a real photograph is necessary,
confirm that redistribution is permitted and document its provenance or licence
in the pull request. A useful regression case includes the input, exact command,
expected mask behaviour, and a description of details that must be preserved.

## Code style

- Use ECMAScript modules and the existing dependency-light architecture.
- Keep the numerical core independent from image I/O.
- Validate user-controlled values before allocating large buffers.
- Prefer soft, confidence-weighted changes and conservative defaults.
