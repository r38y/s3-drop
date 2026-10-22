# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Raycast extension that uploads clipboard files to AWS S3 and copies a 24-hour presigned URL to the clipboard.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development mode (loads extension in Raycast)
npm run build        # Build for production
npm run lint         # Validate the Raycast manifest, ESLint, and formatting
npm run fix-lint     # Auto-fix lint issues
npm run publish      # Publish to Raycast Store
```

Use Node.js and npm because Raycast's CLI requires Node.js 22.14.0 or later. Do not add Bun as a second toolchain. `.tool-versions` pins Node.js; keep `package-lock.json` as the only dependency lockfile. Use `npm ci` for reproducible installs and `npx --no-install` to run installed tools.

## Architecture

This is a Raycast extension using the `no-view` command mode (runs in background without UI).

- `src/drop.ts` - Main command entry point
- `package.json` - Extension manifest (defines commands, preferences, metadata)
- Preferences are defined in `package.json` and accessed via `getPreferenceValues()`

## Key Dependencies

- `@raycast/api` - Raycast extension API (Clipboard, Toast, preferences)
- `@aws-sdk/client-s3` - AWS S3 client for uploads
- `@aws-sdk/s3-request-presigner` - Generate presigned URLs

## Raycast Extension Patterns

- Use `showToast()` for user feedback
- Use `Clipboard.read()` to get clipboard content (returns `{ file?, text?, html? }`)
- Use `Clipboard.copy()` to write to clipboard
- Credentials stored via Raycast preferences (password type uses macOS Keychain)
