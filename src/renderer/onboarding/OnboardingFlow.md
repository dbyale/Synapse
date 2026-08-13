# Pages:

## SetupExperiencePage.tsx
  * Introduction
  * Select Setup Experience 
    * Preferance temporarily saved for setup options

## BackendSetupPage.tsx
  * Inform users that installation will continue in background after continuing
  * Show and pick install location
  * Display all detected backends
    * MacOS
      * Apple Silicon or Non-Apple Silicon
    * x64/arm64 variants
    * Ubuntu/Windows variants
      * Show warning if non-Ubuntu distro
        * Prebuilt binaries may not work and custom builds may be required
        * https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md
    * CUDA
      * When NVIDIA GPU detected
      * Version 12.4 (12.x Requires driver >= 525, < 580)
        * Display warning at end if driver below 525
      * Version 13.3 (13.x Requires driver >= 580)
        * Display warning at end if driver below 580
        * Automatically check for and delete 12.4 after installation
    * OpenCL
      * When Qualcomm Adreno detected
    * HIP/ROCm
      * Shown as optional dependency for advanced users
    * OpenVINO
      * Shown as optional dependency for advanced users
      * Enables NPU support
        * Will require custom code
      * Experimental Tag
    * Custom
      * Allow user to set path to their own binary
    * Vulkan
      * Always downloaded as backup
    - Ensure that laptops with disabled GPU still detect properly

## ParserSetupPage.tsx
  * Same layout as BackendSetupPage.tsx
  * Inform users that installation will continue in background after continuing
  * Show and pick install location
  * Display latest GGUF-Parser-Go for installation
    * amd64/arm64
    * windows/linux/darwin (macOs)

## SystemSetupPage.tsx
  * Show model install location from Settings Page
  * Show system resource allocator from Settings Page

## ProfessionsSetupPage.tsx
  * List of use-cases for AI
  * Preferences temporarily saved to prepare profile options

## ProfileSelectionPage.tsx
  * Curated Profiles available from profession selection
    * Profiles include and are based around links to models
  * Profiles are grouped by model
  * Simple requires at least one profile selected to continue

## ModelDownloadPage.tsx
  * Models for selected profiles are shown with download bars
  * Inform user that they will continue downloading in background
  * Users without adequate space will be shown a warning to free up space

## ServerSetupPage.tsx
  * Host/Port/CORS Settings from Settings Page

## ChatSetupPage.tsx
  * Show Chat Settings from Settings Page

## FinalInstallPage.tsx
  * Show llama binary install progress
  * Show GGUF-Parser-Go install progress
  * Show warnings
    * Non-Ubuntu compatibility warning
    * NVIDIA Driver update warning
    * Any dependency (binary/parser) failure warnings
      * Failed to download
      * Failed to allocate space
  * Show model download progress
  * List any profiles which are ready for use
  * Final Proceed Button
    * Simple requires at least one profile ready

# Simple Path
  1. ProfessionsSetupPage
  2. ProfileSelectionPage
  3. ModelDownloadPage
  4. FinalInstallPage
  * Install backends in background (macOs || CUDA/OpenCL + Vulkan || Vulkan)
  * Install GGUF-Parser-Go in background

# Advanced Path
  1. SystemSetupPage
  2. ProfessionsSetupPage
  3. ProfileSelectionPage
  4. ModelDownloadPage
  5. FinalInstallPage
  * Install backends in background (macOs || CUDA/OpenCL + Vulkan || Vulkan)
  * Install GGUF-Parser-Go in background

# Custom Path
  1. BackendSetupPage
  2. ParserSetupPage
  3. SystemSetupPage
  4. ProfessionsSetupPage
  5. ProfileSelectionPage
  6. ModelDownloadPage
  7. ServerSetupPage
  8. ChatSetupPage
  9. FinalInstallPage
