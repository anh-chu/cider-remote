# Release Guide

This document describes how to create and publish new releases of Cider Remote with auto-update support.

## Prerequisites

- Write access to the GitHub repository
- Ability to push tags to GitHub

## Release Process

### Automated Release via GitHub Actions (Recommended)

This is the standard workflow for creating releases. Each tag automatically builds and publishes to GitHub Releases.

#### 1. Update Version and Create Tag

```bash
# Update version in package.json (use x.y.0 format)
# Edit package.json manually: "version": "0.4.0"

# Create and push tag
git add package.json
git commit -m "Bump version to 0.4.0"
git tag v0.4.0
git push && git push --tags
```

#### 2. Automatic Build and Publish

Once you push the tag:
1. GitHub Actions automatically triggers
2. Builds Windows (NSIS) and macOS (DMG + ZIP) versions
3. Publishes directly to GitHub Releases with all necessary files
4. Release notes are auto-generated

#### 3. Verify Auto-Update

Install the previous version and verify that:
1. The app checks for updates on startup (after 3 seconds)
2. Update notification appears in bottom-right corner
3. Download works and shows progress
4. Install & restart works

**Note:** You can manually trigger an update check using the floating refresh button in the bottom-right corner.

### Manual Local Build (For Testing)

If you need to build locally without publishing to GitHub:

```bash
# Build for testing (does not publish)
npm run electron:build-win
npm run electron:build-mac
```

Artifacts will be in `dist_electron/` directory.

## Version Strategy

This project uses x.y.0 versioning (patch version always 0):

- **0.3.0** → **0.4.0**: Minor version bump for new features/fixes
- **0.9.0** → **1.0.0**: Major milestone
- **1.0.0** → **1.1.0**: Continue incrementing

**Current Version:** 0.3.0

**Note:** electron-builder requires valid semver (major.minor.patch), so we use x.y.0 format where patch is always 0.

### Creating a New Version

1. Edit `package.json` and update the `"version"` field (e.g., `"0.3.0"` → `"0.4.0"`)
2. Commit: `git commit -am "Bump version to 0.4.0"`
3. Tag: `git tag v0.4.0`
4. Push: `git push && git push --tags`
5. GitHub Actions handles the rest

## Release Notes Template

```markdown
## What's New

- Feature: [Description of new feature]
- Fix: [Description of bug fix]
- Improvement: [Description of improvement]

## Installation

Download the appropriate file for your platform:
- Windows: `Cider-Remote-Setup-X.X.exe`
- macOS: `Cider-Remote-X.X.dmg`

## Auto-Update

If you already have Cider Remote installed, the app will automatically notify you of this update.
```

## How It Works

### GitHub Actions Workflow

The `.github/workflows/build-electron.yml` workflow:

1. **Triggers** on any tag push matching `v*` (e.g., `v0.4.0`, `v1.0.0`)
2. **Builds** on both macOS and Windows runners in parallel
3. **Publishes** directly to GitHub Releases using `--publish always`
4. **Uploads** all necessary files:
   - Windows: NSIS installer, blockmap, `latest.yml`
   - macOS: DMG, ZIP, `latest-mac.yml`

The workflow uses `GITHUB_TOKEN` which is automatically available in GitHub Actions.

## Troubleshooting

### Update Not Detected

1. Verify `latest.yml` / `latest-mac.yml` is in the GitHub Release
2. Check that the version in the release is higher than installed version
3. Ensure the release is marked as "Latest" (not pre-release)

### Build Fails on GitHub Actions

1. Check the Actions logs for specific errors
2. Verify the tag format is `vX.Y.Z` (e.g., `v0.4.0`)
3. Ensure `package.json` version matches the tag (without the `v` prefix)
4. Version must be valid semver (three numbers: major.minor.patch)
