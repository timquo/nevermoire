# Security policy

## Supported versions

Nevermoire is currently an early-stage project. Security fixes are applied to
the latest release on the default branch.

| Version | Supported |
| --- | --- |
| Latest | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
**Report a vulnerability** feature in the repository's Security tab. Include:

- the affected version or commit;
- a minimal reproduction or sample file, where safe to share;
- the expected and observed behaviour;
- the possible impact.

If private vulnerability reporting is not enabled, contact the repository
owner privately through their public GitHub profile and ask for a secure
reporting channel. Do not include exploit details in the initial public
message.

Nevermoire processes untrusted image files through `sharp`/libvips. Keep
dependencies updated and avoid processing confidential originals from an
untrusted shared environment. The CLI limits decoded inputs to 8 million
pixels by default (30 million maximum when explicitly requested) and removes
image metadata from generated outputs, but no parser should
be treated as a perfect security boundary.
