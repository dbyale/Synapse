# Startup

- Setup opens automatically on launch when `onboardingCompleted` is absent and no profiles are stored
- Completing the final setup page stores `onboardingCompleted`
- Cancelling or quitting before completion leaves the marker unset, so setup opens again on the next launch
- Existing stored profiles are treated as already set up
- Restart Onboarding remains available from the menu

# Pages:

## SetupExperiencePage.tsx

- Introduction
- Select Setup Experience
  - Preferance temporarily saved for setup options

## BackendSetupPage.tsx

- Inform users that installation will continue in background after continuing
- Show and pick install location
- Display all detected backends
  - MacOS
    - Apple Silicon or Non-Apple Silicon
  - x64/arm64 variants
  - Ubuntu/Windows variants
    - Show warning if non-Ubuntu distro
      - Prebuilt binaries may not work and custom builds may be required
      - https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md
  - CUDA
    - When NVIDIA GPU detected
    - Version 12.4 (12.x Requires driver >= 525, < 580)
      - Display warning at end if driver below 525
    - Version 13.4 (13.x Requires driver >= 580)
      - Display warning at end if driver below 580
      - Automatically check for and delete 12.4 after installation
  - OpenCL
    - When Qualcomm Adreno detected
  - HIP/ROCm
    - Shown as optional dependency for advanced users
  - OpenVINO
    - Shown as optional dependency for advanced users
    - Enables NPU support
      - Will require custom code
    - Experimental Tag
  - Custom
    - Allow user to set path to their own binary
  - Vulkan
    - Always downloaded as backup
  * Ensure that laptops with disabled GPU still detect properly

## SystemSetupPage.tsx

- Show install locations from Settings Page (Models / Backend directories) — exact parity with Settings → System → Application Setup
- Show system resource allocator from Settings Page (RAM + VRAM MemorySlider, buffered save on Continue)

## PythonSetupPage.tsx

- Install a private, app-managed CPython runtime (pinned python-build-standalone
  release, verified by SHA-256) into a Synapse-managed folder
- Show and pick install location (parity with System → Application Setup)
- Show detected runtimes (managed by Synapse / system Python on PATH)
- Fall back to a system Python when one is already available
- Inform users that installation will continue in background after continuing

## SecuritySetupPage.tsx

- Show Security Settings from Settings Page (disableExternalReadmes)

## ProfessionsSetupPage.tsx

- List of use-cases for AI
- Preferences temporarily saved to prepare profile options

## ProfileSelectionPage.tsx

- Categories available from profession selection
  - Categories are developer-defined and map to one or more models internally
  - Category options are hardware-fit tiers such as light, balanced, and best quality
- Multiple options can be selected within a category
- Already installed models are detected and shown as Installed, and their files are excluded from the download total
- Unchecked options show their incremental download size, or +0.0 GB when shared files are already selected
- Model names and repository links stay hidden on the option cards
- Total download size is shown to one decimal place, with an expandable breakdown of each model and projector
- Starting a download checks local models first and skips files that are already installed
- Simple and Advanced require at least one option selected to continue

## ModelDownloadPage.tsx

- Downloads are grouped by model rather than by individual category option
- Categories sharing a model are shown together, such as Translator + Tutor + Writing Assistant
- Model names are shown; filenames and repository links stay hidden
- Download bars use combined downloaded and total bytes across the model and projector
- Each model group mirrors the download manager actions: retry, resume, and cancel
- Cancelling asks for confirmation, lists the affected profiles, and discards those profiles from the selection
- Groups switch to Installed once the downloaded files are verified locally
- Inform user that downloads will continue in the background
- Users without adequate space will be shown a warning to free up space
- Custom can continue without selected assistants or model downloads

## ServerSetupPage.tsx

- Host/Port/CORS Settings from Settings Page (Host, Port, CORS Origins/Methods/Headers/Credentials — exact parity with Settings → Server)

## ChatSetupPage.tsx

- Show Chat Settings from Settings Page (autoOpenThinking / autoCloseThinkingDone + launchServerAutomatically)
- Finishing setup launches the selected profile once even when auto-launch is disabled; the saved preference is unchanged

## FinalInstallPage.tsx

- Show llama binary install progress
- Show warnings
  - Non-Ubuntu compatibility warning
  - NVIDIA Driver update warning
  - Any dependency (binary) failure warnings with Retry
    - Failed to download
    - Failed to allocate space
- Show model download progress
- List any profiles which are ready for use
- Final Proceed Button
  - Simple and Advanced require at least one profile ready
  - Custom may proceed without a ready profile
  - Launches the selected profile after setup completes, regardless of the auto-launch setting

# Simple Path

- Install backends + python in background

1. ProfessionsSetupPage
2. ProfileSelectionPage
3. ModelDownloadPage
4. FinalInstallPage

# Advanced Path

- Install backends in background

1. SystemSetupPage
2. ProfessionsSetupPage
3. ProfileSelectionPage
4. ModelDownloadPage
5. PythonSetupPage
6. ChatSetupPage
7. FinalInstallPage

# Custom Path

1. BackendSetupPage
2. SystemSetupPage
3. ProfessionsSetupPage
4. ProfileSelectionPage
5. ModelDownloadPage
6. PythonSetupPage
7. ServerSetupPage
8. SecuritySetupPage
9. ChatSetupPage
10. FinalInstallPage
