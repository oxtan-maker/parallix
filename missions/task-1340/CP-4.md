# CP-4: install path documented

## Work Done

Updated `README.md` to document the one-command install path `npm install -g @magnusekdahl/parallix` while preserving the local tarball path for backward compatibility.

### Changes made:

1. **Quick start section** (README.md:62-91): Replaced the tarball-only install path with a two-option approach:
   - Option A: `npm install -g @magnusekdahl/parallix` (recommended, from npm registry)
   - Option B: `npm pack && npm install -g ./magnus-parallix-*.tgz` (local tarball, for development/air-gapped)
   - Added `px shell-init` setup example to the quick start

2. **Intro paragraph** (README.md:11): Changed "build the local tarball" to "install the px CLI" to reflect the registry install path.

3. **First concrete thing code block** (README.md:13-17): Replaced tarball build commands with `npm install -g @magnusekdahl/parallix`, noting the tarball alternative in a comment.

4. **Current status section** (README.md:155): Updated Distribution line to mention `npm install -g @magnusekdahl/parallix` from the public npm registry alongside the local tarball option.

5. **Versioning line** (README.md:157): Removed "until a first public release" qualifier since the package is now ready for publication.

6. **Removed duplicate shell-init mention**: Consolidated the `px shell-init` documentation into the Quick start section to avoid duplication.

### Install path verification:

The README now documents:
- One-command install: `npm install -g @magnusekdahl/parallix` (README.md:67)
- Post-install verification: `px --version` (README.md:82)
- Optional shell-init: `eval "$(px shell-init bash)"` (README.md:90-92)
- Backward-compatible tarball path preserved (README.md:69-70)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| One-command install documented | README.md:67 → `npm install -g @magnusekdahl/parallix` |
| Post-install verification documented | README.md:82 → `px --version` |
| Optional shell-init documented | README.md:90-92 → `eval "$(px shell-init bash)"` |
| Local tarball path preserved | README.md:69-70 → `npm pack && npm install -g ./magnus-parallix-*.tgz` |
| Current status updated | README.md:155 → mentions npm registry publish |

## Next action

Proceed to CP-5: verify tarball builds and extracts cleanly.
