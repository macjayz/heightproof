# Releasing

A `v*` tag releases everything at that version:

- `.github/workflows/release.yml` publishes the container images and the Helm chart to GHCR.
- `.github/workflows/npm-publish.yml` publishes `@heightproof/shared`, `@heightproof/sdk-node`
  and `@heightproof/web3` to npm, in that order, with provenance.

## Cutting a release

1. Set the version in all three packages, and in the exact pins they hold on each other:

   ```bash
   VERSION=0.2.0
   npm version "$VERSION" --no-git-tag-version -w packages/shared -w packages/sdk-node -w packages/web3
   npm pkg set "dependencies.@heightproof/shared=$VERSION" -w packages/sdk-node -w packages/web3
   npm pkg set "dependencies.@heightproof/sdk-node=$VERSION" -w packages/web3
   npm install
   ```

2. Add the release to `CHANGELOG.md`, then open a PR and merge it once CI is green.
3. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag "v$VERSION" && git push origin "v$VERSION"
   ```

The workflow refuses to publish when a package version or an internal pin does not match the
tag. It skips any package already published at that version, so a failed run can be re-run.

To check a release without publishing it, run **npm publish** from the Actions tab with
`dry_run` checked.

## One-time setup: trusted publishing

The workflow authenticates with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC), so no npm token is stored in GitHub. npm only lets you add a trusted publisher to a package
that already exists, so:

1. Publish the first version by hand, from a clean checkout of `main`, as an owner of the
   `heightproof` npm organization:

   ```bash
   npm login
   npm run build
   npm publish -w packages/shared --access public
   npm publish -w packages/sdk-node --access public
   npm publish -w packages/web3 --access public
   ```

2. On npmjs.com, for each of the three packages, go to **Settings → Trusted publishing** and add
   GitHub Actions with:

   | Field        | Value             |
   | ------------ | ----------------- |
   | Organization | `macjayz`         |
   | Repository   | `heightproof`     |
   | Workflow     | `npm-publish.yml` |

3. Optionally, under **Settings → Publishing access** for each package, require 2FA and disallow
   tokens. Trusted publishing keeps working, and nobody can publish with a leaked token.

Every release after that is just a tag.
