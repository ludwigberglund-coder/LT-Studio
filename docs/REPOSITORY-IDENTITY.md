# Repository identity

Canonical GitHub repository:

- Repository: `ludwigberglund-coder/LT-Studio`
- URL: https://github.com/ludwigberglund-coder/LT-Studio
- Default branch: `main`

The repository was renamed from `Rollands` to `LT-Studio` on 2026-09-21.

## Operational rule

GitHub is the source of truth for this project. New documentation, automation references and deployment instructions must use the canonical `LT-Studio` repository identity.

Do not create a new repository named `Rollands` as a replacement or redirect target. Historical references to the customer/company name Rollands inside business data, tests and product documentation are intentional and are not repository references.

## GitHub Pages

The Pages workflow is repository-name agnostic and deploys the generated `dist` artifact via `actions/deploy-pages`. After a repository rename, verify the next `main` deployment and use the URL reported by the GitHub Pages deployment rather than assuming the old project-site path remains valid.

## Local clones

Existing clones may continue to follow GitHub's repository redirect, but the preferred remote is:

`https://github.com/ludwigberglund-coder/LT-Studio.git`

Anyone with an existing local clone should update its `origin` URL before relying on it for future work.
