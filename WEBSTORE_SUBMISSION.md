# StageSeat Chrome Web Store Copy

## Store Name

StageSeat

## Short Description

Hear the current tab like you're sitting in different seats inside a venue.

## Detailed Description

StageSeat turns seat position into sound.

Open StageSeat on the current music or video tab, then drag your seat across a venue map to hear how the perspective changes in real time.

Move forward for a closer, clearer sound.
Move backward for more distance and space.
Move off-center for a more side-weighted listening perspective.
Jump back to the sweet spot with one click.

StageSeat processes the selected tab's audio locally using the Web Audio API. It does not save, export, or upload audio.

Best for:

- YouTube music sessions
- web players and live recordings
- comparing venue perspectives
- creative listening and demo experiences

## Single Purpose Statement

StageSeat lets users hear the current tab from different virtual seat positions in a venue by processing that tab's audio locally in real time.

## Test Instructions For Reviewers

1. Open a YouTube video or other browser tab with audible playback.
2. Start playback.
3. Click the StageSeat toolbar icon on that source tab.
4. The side panel opens for that tab and audio processing starts.
5. Drag the `Seat` marker on the venue map.
6. Notice that the sound changes as the seat moves forward, backward, or off-center.
7. Click `Sweet Spot` to snap back to the center listening position.
8. Use the top-right toggle to turn processing off and on.

## Permissions Justification

- `activeTab`
  Used only after the user clicks the extension action so StageSeat can operate on the chosen source tab.

- `tabs`
  Used to identify the selected source tab and keep the side panel attached to the correct tab context.

- `tabCapture`
  Required to capture audio from the user-selected current tab.

- `offscreen`
  Required to run the Web Audio processing pipeline while the source tab is active.

- `sidePanel`
  Required to show the StageSeat seat map and controls.

- `storage`
  Used only to store local settings such as seat position, realism, and energy.

## Privacy Disclosure Draft

- StageSeat does not collect personal information.
- StageSeat does not transmit audio or browsing data to remote servers.
- StageSeat does not sell or share user data.
- Audio is processed locally on-device.
- The extension stores only local preference data needed for product functionality.
