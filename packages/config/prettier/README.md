# @binderly/prettier-config

Shared Prettier configuration for every Binderly app and package.

## Settings

| Option          | Value      |
| --------------- | ---------- |
| `printWidth`    | `100`      |
| `singleQuote`   | `true`     |
| `trailingComma` | `'all'`    |
| `semi`          | `true`     |
| `arrowParens`   | `'always'` |

## Usage

Add the package to the consumer's `package.json` and reference it via the
`prettier` field:

```json
{
  "name": "@binderly/web",
  "devDependencies": {
    "@binderly/prettier-config": "workspace:*",
    "prettier": "3.8.3"
  },
  "prettier": "@binderly/prettier-config"
}
```

Then `prettier --check .` (or `--write .`) inside that package will
resolve the config from this workspace package.

The repo-wide `.prettierignore` lives at the repository root and covers
build outputs and lockfiles for every package.
