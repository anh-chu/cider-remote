# Release Guide

This document describes how to create and publish new releases of Cider Remote with auto-update support.

## Prerequisites

- Write access to the GitHub repository
- GitHub Personal Access Token (for automated publishing)
- All platforms you want to build for (or use CI/CD)

## Release Process

### Option 1: Manual Release (Recommended for first-time)

#### 1. Update Version Number

```bash
# Patch version (1.0.0 -> 1.0.1)
npm version patch

# Minor version (1.0.0 -> 1.1.0)
npm version minor

# Major version (1.0.0 -> 2.0.0)
npm version major
```

This automatically:
- Updates `package.json`
- Creates a git commit
- Creates a git tag

#### 2. Build Distributables

Build for your target platforms:

```bash
# Windows (NSIS Installer)
npm run electron:build-win

# macOS (DMG + ZIP for both architectures)
npm run electron:build-mac

# Linux (AppImage)
# Note: Requires Linux environment
npm run build && electron-builder --linux
```

Artifacts will be in the `dist_electron/` directory.

#### 3. Create GitHub Release

1. Go to https://github.com/anh-chu/cider-remote/releases
2. Click "Draft a new release"
3. Choose the tag created by `npm version` (e.g., `v1.0.1`)
4. Fill in release title and description
5. Upload **ALL** files from `dist_electron/`:
   - `*.exe` (Windows NSIS installer)
   - `*.dmg` (macOS disk image)
   - `*.zip` (macOS zip - required for auto-updates)
   - `*.AppImage` (Linux)
   - `latest.yml` (Windows update metadata)
   - `latest-mac.yml` (macOS update metadata)
   - `latest-linux.yml` (Linux update metadata)
6. Click "Publish release"

#### 4. Verify Auto-Update

Install the previous version and verify that:
1. The app checks for updates on startup
2. Update notification appears
3. Download works
4. Install & restart works

### Option 2: Automated Release with GitHub Token

#### 1. Set Up GitHub Token

Create a GitHub Personal Access Token with `repo` scope:
1. Go to GitHub Settings > Developer settings > Personal access tokens
2. Generate new token (classic)
3. Select `repo` scope
4. Copy the token

#### 2. Configure Token

```bash
# Export token for current session
export GH_TOKEN="your_github_token_here"

# Or add to ~/.bashrc or ~/.zshrc for persistence
echo 'export GH_TOKEN="your_github_token_here"' >> ~/.bashrc
```

#### 3. Build and Publish

```bash
# Update version
npm version patch

# Build and publish in one command
npm run electron:build-win -- --publish always
npm run electron:build-mac -- --publish always
```

This automatically:
- Builds the distributables
- Creates a GitHub Release with the git tag
- Uploads all artifacts
- Publishes the release

## Version Strategy

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (1.0.0 -> 1.0.1): Bug fixes, minor improvements
- **Minor** (1.0.0 -> 1.1.0): New features, backward compatible
- **Major** (1.0.0 -> 2.0.0): Breaking changes

## Release Notes Template

```markdown
## What's New

- Feature: [Description of new feature]
- Fix: [Description of bug fix]
- Improvement: [Description of improvement]

## Installation

Download the appropriate file for your platform:
- Windows: `Cider-Remote-Setup-X.X.X.exe`
- macOS: `Cider-Remote-X.X.X.dmg` or `Cider-Remote-X.X.X-mac.zip`
- Linux: `Cider-Remote-X.X.X.AppImage`

## Auto-Update

If you already have Cider Remote installed, the app will automatically notify you of this update.
```

## Troubleshooting

### Update Not Detected

1. Verify `latest.yml` / `latest-mac.yml` is uploaded to the release
2. Check that the version in `package.json` is higher than installed version
3. Ensure the release is marked as "Latest" (not pre-release)

### Build Fails

1. Clean build directories: `rm -rf dist dist_electron`
2. Reinstall dependencies: `npm install`
3. Try building again

### Code Signing (macOS)

For production releases, sign the macOS app:

```bash
# Set up Apple Developer certificates
export APPLE_ID="your@email.com"
export APPLE_ID_PASSWORD="app-specific-password"
export TEAM_ID="your-team-id"

# Build with signing
npm run electron:build-mac
```

Add to `package.json` build config:
```json
"mac": {
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist"
}
```

## CI/CD Integration

For automated releases on every tag push, create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      - run: npm install

      - name: Build and Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npm run build
          npx electron-builder --publish always
```

This automatically builds and publishes releases for all platforms when you push a tag.
