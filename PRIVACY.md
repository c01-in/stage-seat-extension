# StageSeat Privacy Policy

Effective date: April 12, 2026

StageSeat is a Chrome extension that reshapes the audio of the current browser tab based on a virtual seat position.

## What StageSeat Does

- Captures audio from the user-selected tab after an explicit user action
- Processes that audio locally with the Web Audio API
- Lets the user move a seat position in a side panel to hear different venue perspectives

## Data Collection

- StageSeat does not collect personal data
- StageSeat does not transmit audio, browsing data, or settings to any remote server
- StageSeat does not use analytics, ads, trackers, or remote code

## Audio Handling

- Audio is processed locally on the user's device
- Audio is not stored, recorded, downloaded, exported, or shared
- StageSeat only affects the active user-selected source tab

## Local Storage

StageSeat stores a small amount of local extension state so the experience feels consistent between sessions:

- selected venue preset
- listener position
- realism value
- energy value

This information is stored locally in Chrome extension storage and is used only for core product functionality.

## Permissions

- `activeTab`: used after the user clicks the extension action to work with the current source tab
- `tabs`: used to identify the current source tab and show the correct tab context in the UI
- `tabCapture`: used to capture the current tab's audio stream
- `offscreen`: used to run the background audio processing pipeline
- `sidePanel`: used to render the StageSeat control UI
- `storage`: used to save local user settings

## Data Sharing

StageSeat does not sell, share, or transfer user data to third parties.

## Security

StageSeat does not fetch or execute remote code. All audio processing runs locally inside the extension.

## Changes

If this policy changes, the latest version will be published with the extension materials.
