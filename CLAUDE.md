# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cider Remote is a remote control application for the Cider Apple Music client. It consists of three main components:

1. **React Web App** (`src/`) - Remote control interface built with React, Vite, and TailwindCSS
2. **Electron Desktop App** (`electron/`) - Native desktop wrapper for the web app
3. **Coordinator Server** (`server/`) - Socket.io-based server for "Listen Together" feature

## Development Commands

### Client (Web/Electron)

```bash
# Development (web only)
yarn run dev  # or: bun dev

# Development with Electron
yarn run electron:dev

# Build for production
yarn run build

# Build Electron apps (local build without publishing)
yarn run electron:build-mac    # macOS (outputs dmg + zip)
yarn run electron:build-win    # Windows (outputs NSIS installer)

# Build and publish to GitHub Releases (requires GH_TOKEN)
yarn run electron:publish-mac
yarn run electron:publish-win

# Linting
yarn run lint
```

### Server (Coordinator)

```bash
cd server

# Production
yarn start

# Development (with auto-reload)
yarn run dev

# Docker deployment
docker build -t cider-remote-server .
docker run -d -p 3001:3001 cider-remote-server
```

## Architecture

### Client Architecture

**Communication Flow:**
- App.jsx polls Cider RPC API (default: `http://localhost:10767`) every 1.5 seconds
- Uses API token authentication via `apitoken` and `app-token` headers
- Implements optimistic UI updates with debouncing to prevent state conflicts
- Integrates ListenTogether.jsx for synchronized listening sessions

**Key State Management:**
- `App.jsx` manages Cider connection, playback state, and API polling
- `ListenTogether.jsx` manages Socket.io connection, room state, and master/slave coordination
- Shared state flows through `ciderState` prop and `onRemoteAction` callback

**Master/Slave Pattern:**
- In Listen Together mode, one client becomes "Master" (controls Cider)
- Master broadcasts state updates to server every 500ms
- Slave clients relay control actions to Master via server
- Automatic master reassignment when master disconnects

### Server Architecture

**Coordinator Server** (`server/index.js`):
- Express + Socket.io server managing real-time room state
- In-memory state management with room-based isolation
- Handles master role assignment and transfer
- Relays remote actions from slaves to master
- State includes: queue, history, playback info, users, masterId

**Key Events:**
- `join_room` - User joins, server syncs current state
- `master_state_update` - Master broadcasts state (validated by server)
- `remote_action` - Slave sends control request (forwarded to master)
- `transfer_master` - Current master transfers role to another user
- `leave_room` / `disconnect` - Cleanup and master reassignment

### API Integration

**Cider RPC Endpoints Used:**
- `GET /api/v1/playback/active` - Connection check
- `GET /api/v1/playback/is-playing` - Play state
- `GET /api/v1/playback/now-playing` - Current track info
- `POST /api/v1/playback/playpause` - Toggle playback
- `POST /api/v1/playback/seek` - Seek to position
- `POST /api/v1/amapi/run-v3` - Apple Music catalog search (for Listen Together)
- `POST /api/v1/playback/play-item` - Play specific song by ID

## Development Notes

### Important Behaviors

**Seek Debouncing:**
- 8-second debounce after seek operations to prevent phantom syncs
- Optimistic updates applied immediately for responsive UI
- `lastSeekTime` ref shared between App and ListenTogether to coordinate

**Mixed Content Warning:**
- HTTPS-served app cannot connect to HTTP localhost Cider instances
- User must explicitly allow insecure content in browser settings
- Electron build bypasses this with `webSecurity: false`

**Polling Strategy:**
- Smart polling stops after 3 consecutive errors to prevent console spam
- Volume and shuffle/repeat modes polled every 5th tick (~7.5s) to reduce load
- Client-side interpolation provides smooth progress bar between polls

### Configuration Storage

- Client config stored in localStorage as `cider_config` (host, token)
- Server URL stored in localStorage as `cider_remote_url`
- No persistent database - all room state is in-memory

### Vite Development Proxy

The vite.config.js includes a proxy for development that routes `/api` requests to bypass CORS. Configure via environment variable:

```bash
# Create .env file (see .env.example)
VITE_CIDER_HOST=http://localhost:10767
```

The proxy only affects `npm run dev`. Production builds use the host URL configured in app settings.

### Build Output

- Web build: `dist/` directory
- Electron build: `dist_electron/` directory
- Server runs standalone with its own `node_modules`

## Technology Stack

**Frontend:**
- React 18 with hooks
- Vite for bundling
- TailwindCSS for styling
- Lucide React for icons
- Socket.io-client for real-time communication

**Desktop:**
- Electron with CommonJS entry point
- Hidden title bar with custom overlay

**Backend:**
- Node.js + Express
- Socket.io for WebSocket communication
- In-memory state management

**Development:**
- Concurrently for running multiple processes
- Cross-env for environment variables
- Wait-on for service readiness checks

## Auto-Update System

The Electron app includes automatic update functionality powered by `electron-updater`.

### How It Works

- Checks for updates on GitHub Releases automatically on app startup
- Downloads updates in the background when available
- Notifies users with an in-app notification UI
- Allows users to install updates with one click
- Manual check available via floating button in bottom-right corner

### Update Flow

1. **Check**: App checks GitHub Releases on startup (3 seconds delay)
2. **Notify**: If update available, shows notification with version info
3. **Download**: User clicks "Download Update" button
4. **Install**: Once downloaded, user clicks "Install & Restart"
5. **Update**: App quits and installs the new version

### Build Configuration

Auto-updates require specific build targets:
- **Windows**: NSIS installer (not portable.exe)
- **macOS**: DMG + ZIP (supports both Intel and Apple Silicon)

### Publishing Releases

Releases are automatically published via GitHub Actions:

**Stable Releases:**
```bash
git tag v0.4.0
git push && git push --tags
```

**Dev Releases:**
```bash
git tag v0.5.0-dev.1
git push && git push --tags
```

GitHub Actions automatically:
- Extracts version from git tag
- Builds Windows NSIS installer and macOS DMG/ZIP
- Publishes to GitHub Releases with all update metadata files
- Existing installations will detect the update automatically

**Note:** Version must be valid semver (x.y.z format).
- Stable releases: `v0.4.0`, `v0.5.0`
- Dev releases: `v0.5.0-dev.1`, `v0.5.0-dev.2`

### Testing Updates

Auto-updates only work in packaged production builds, not in development mode. To test:

1. Build and install version 0.3.0
2. Bump to version 0.4.0, tag, and push
3. GitHub Actions builds and publishes the release
4. Run the installed 0.3.0 app - it should detect the update after 3 seconds

### Update Channels

Cider Remote supports two update channels:

**Release Channel (Default)**
- Stable, production-ready builds
- Recommended for most users
- Version format: `0.4.0`, `0.5.0`
- Metadata files: `latest-mac.yml`, `latest.yml`

**Dev Channel**
- Development builds with newest features
- May contain bugs or unstable features
- Version format: `0.5.0-dev.1`, `0.5.0-dev.2`
- Metadata files: `dev-mac.yml`, `dev.yml`

**Switching Channels**

1. Click the refresh button in the bottom-right corner to open the update notification
2. Toggle between "Release" and "Dev" in the notification card
3. App will immediately check for updates on the new channel
4. Preference is saved in browser localStorage as `update_channel`

**Publishing Dev Releases**

```bash
# Just tag and push - GitHub Actions handles the rest
git tag v0.5.0-dev.1
git push && git push --tags

# GitHub Actions automatically:
#   - Extracts version from tag (0.5.0-dev.1)
#   - Builds for macOS and Windows
#   - Generates dev-mac.yml and dev.yml metadata files
#   - Publishes to GitHub Releases with prerelease flag
#   - Only detected by apps with dev channel enabled
```

**Version Naming Convention**
- Stable releases: `v0.4.0`, `v0.5.0` (no prerelease tag)
- Dev releases: `v0.5.0-dev.1`, `v0.5.0-dev.2`, `v0.5.0-dev.3`
- electron-updater automatically filters releases by channel based on semver

**How Channel Detection Works**

electron-updater detects channels based on:
1. Semver prerelease tags in version numbers
2. The `autoUpdater.channel` property set by the main process

When channel is set to:
- `'latest'` - Only checks for stable releases (no prerelease tag)
- `'dev'` - Only checks for dev releases (with `-dev` prerelease tag)

**Metadata Files**

electron-builder automatically generates different metadata files based on channel:
- Stable builds: `latest-mac.yml`, `latest.yml` (uploaded by `build-electron.yml`)
- Dev builds: `dev-mac.yml`, `dev.yml` (uploaded by `build-electron-dev.yml`)

Both sets of files can coexist in the same GitHub Release. The correct metadata file is selected by electron-updater based on the current channel setting.

**Edge Cases**

- **Downgrading**: If dev version (0.5.0-dev.1) is newer than stable (0.4.2), switching to Release channel won't trigger a downgrade. This is expected electron-updater behavior.
- **Missing Metadata**: If no dev releases exist and user switches to dev channel, shows "up to date" or "no updates available" - not an error.
- **localStorage Failure**: Falls back to default `latest` channel if localStorage unavailable.
