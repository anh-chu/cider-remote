# GitHub Actions Workflows

## Build Electron Apps

The `build-electron.yml` workflow automatically builds the Electron desktop application for macOS and Windows.

### Triggers

The workflow runs on:
- **Push to main branch** - Builds and uploads artifacts (retained for 30 days)
- **Pull requests to main** - Validates builds work
- **Version tags** (e.g., `v1.0.0`) - Creates a GitHub Release with downloadable binaries
- **Manual dispatch** - Can be triggered manually from GitHub Actions tab

### Build Matrix

Builds are created for:
- **macOS** (macos-latest) - Outputs `.zip` file
- **Windows** (windows-latest) - Outputs portable `.exe` file

### Artifacts

After each build, artifacts are uploaded and available for download from the Actions tab:
- `cider-remote-macos` - Contains the macOS .zip file
- `cider-remote-windows` - Contains the Windows portable .exe file

### Creating a Release

To create a new release:

1. Tag your commit with a version number:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. The workflow will automatically:
   - Build for both platforms
   - Create a GitHub Release
   - Attach the binaries to the release
   - Generate release notes from commits

### Requirements

- Repository must have Actions enabled
- For releases, ensure the workflow has `contents: write` permission (already configured)

### Troubleshooting

If builds fail:
- Check the Actions tab for detailed logs
- Ensure `package.json` has all required dependencies
- Verify `electron-builder` configuration is correct
- For macOS code signing issues, builds will succeed but won't be notarized (fine for personal use)

### Local Testing

To test builds locally before pushing:

```bash
# macOS
npm run electron:build-mac

# Windows
npm run electron:build-win
```

Build outputs will be in the `dist_electron/` directory.
