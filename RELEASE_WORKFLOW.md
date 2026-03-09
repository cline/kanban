# Kanban release workflow

## Overview

This repository uses three GitHub Actions workflows for quality gates and publishing:

- `.github/workflows/test.yml`
  - Reusable test workflow used by CI and Publish workflows.
  - Runs build, checks, and web-ui unit tests.
- `.github/workflows/ci.yml`
  - Runs on pushes and pull requests targeting `main`.
  - Calls the reusable `test.yml` workflow.
- `.github/workflows/publish.yml`
  - Manual only via `workflow_dispatch`.
  - Publishes a tagged release to npm using OIDC trusted publishing.
  - Creates a GitHub Release using changelog content.

## Contributor workflow

For regular development:

- Open a PR to `main`.
- CI runs `test.yml` automatically.
- Merge once checks pass.

For direct pushes to `main`:

- CI also runs automatically on push.

## Release responsibilities

Release prep is intentionally manual on the maintainer side:

1. Update `CHANGELOG.md` with a section for the new version.
2. Bump `package.json` version.
3. Commit and push those changes.
4. Create and push a matching git tag in the form `vX.Y.Z` (or prerelease like `vX.Y.Z-beta.1`).

Example:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Pushing the tag does not publish automatically.

## Manual publish in GitHub UI

1. Open Actions in GitHub.
2. Select `Publish` workflow.
3. Click `Run workflow`.
4. Enter the tag you already pushed, for example `v0.2.0`.
5. Run the workflow.

## What publish.yml does

Given the input tag, the workflow:

1. Fetches tags and verifies the input tag exists.
2. Checks out the exact commit for that tag.
3. Validates tag format (`vX.Y.Z` with optional prerelease suffix).
4. Runs the reusable test workflow (`test.yml`).
5. Verifies `tag == v${package.json version}`.
6. Runs `npm run prepublishOnly`.
   - This runs build + checks before publish.
7. Publishes with:

```bash
npm publish --provenance --access public
```

8. Extracts the matching version section from `CHANGELOG.md`.
9. Creates a GitHub Release for the tag with that changelog section as release body.
10. Adds a compare link to the previous tag when available.

## Expected failure cases

Publish will fail if:

- The input tag does not exist.
- The tag does not match `package.json` version.
- `CHANGELOG.md` is missing.
- The changelog section for that version is missing or empty.
- Build/tests/checks fail.
