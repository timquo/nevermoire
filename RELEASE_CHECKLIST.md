# Public release checklist

## Required before the first public push

- [ ] Confirm the final repository name and visibility.
- [x] Record the source, author, Unsplash licence, download date, and source
      checksum for every file in `docs/assets/README.md`.
- [ ] Configure a public Git author identity. If the normal email address is
      private, use the GitHub-provided `noreply` address before the first commit.
- [ ] Review the complete first commit with `git diff --cached --stat` and
      `git diff --cached`.
- [ ] Confirm that ignored working directories do not appear in
      `git status --short`.

## Automated checks

```sh
npm ci
npm run check
npm audit --omit=dev --audit-level=low
npm pack --dry-run
```

- [x] All tests pass.
- [x] The secret scanner passes.
- [x] The dependency audit reports zero known vulnerabilities.
- [x] The npm pack preview contains only `LICENSE`, `README.md`, `package.json`,
      and `src/`.
- [x] All three documentation images report no EXIF/XMP/IPTC/GPS/comments.

## GitHub repository settings

- [ ] Enable private vulnerability reporting.
- [ ] Enable Dependabot alerts and security updates.
- [ ] Enable secret scanning and push protection if available for the account.
- [ ] Protect the default branch and require the CI workflow before merging.
- [ ] Disable force pushes and branch deletion on the protected branch.
- [ ] Add a short repository description and topics such as `moire`,
      `image-processing`, `fft`, `photography`, and `cli`.
- [ ] Create a `v0.1.0` release after CI passes on the public repository.

## Optional npm publication

The GitHub release does not require publishing to npm. Before any npm release,
confirm package-name ownership, add the final `repository`, `bugs`, and
`homepage` fields to `package.json`, and enable npm provenance and two-factor
authentication. Do not publish from an unreviewed workstation.
