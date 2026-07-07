# App:
  * Auto-updater from Releases
  * Correct topbar handler
  * Correct AppData directory
  * Naming and Metadata

# Chat:
  * Set default model
  * Better scroll hooking
  * Cancel model loading
  * Token counter includes images/overhead
  * Contain tool calls while thinking within the initial thinking section
  ## Uploads
    * Add text-based filetypes to upload [File->MD](https://github.com/microsoft/markitdown)
    * Official LLama CPP video support rather than frame extractor
      * This seems to currently be broken, even on official WebUI always fails
        * (Maybe missing unknown dependency or user error but either way would be too unreliable)
      * Current frame extractor does not extract audio
    * Audio Support
      * Similar to video support, appears to be broken
  ## Stored messages
    * Save sessions to localstorage per-profile
      * Delete/rename sessions
      * Default name is start of user input
      * New Sessions extension
        * AI can rename current/previous session
        * Can access previous sessions
    * Allow exporting of sessions as MD
    * Allow easy clearing of sessions

# Models:
  * Search
    * Return more data per query
      * Cache results instead of rendering too many elements, then pull from cache rather than re-search on scroll
    * Check for equivelent HF Resolvers (higher API Limit)
      * Warn on other
        * Not sure what file is, will be treated as model

# Estimator:
  * Reports missing model
  * Reports model too large
  * Use parser on Models page remotely (it only downloads GGUF header)
  * We just need a whole new estimator

# RAG:
  * Built into Profiles
  ## Text Chunking:
    * Auto-Chunking on length
    * LLM tool powered chunking
    * Hierarchal (Child-Parent) and standard Chunk Support
  ## Retrieval:
    * Libraries section
      * Configurable per-profile
      * Standardized export?
    ### Options:
      * Set # of results to return
      * Retrives at start of prompt option
      * Retrive start of each message
      * Additional retrieval tool option
    ### ReRanking model
      * Also set per profile
      * Set total and final count #s

# Profiles:
  * Add new settings for models, projectors, performance, etc [LLama Server Flags](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
  * Autosave
  * Better list auto-selection
    * Recreate lists to be a modal with search
  * System prompt variables (dates, device info, etc)

# Settings:
  * Optional HF token
  * Setting to automatically expand thinking sections, or automatically contract them after finish

# Maintenance:
  * Clear unnecessary packages
  * Update packages
  * Clean up ipc.ts, preload.ts, preload.d.ts
    * Remove unused
    * Organize existing into readable sections
  * Add file name as top comment to all files
  * Set up Metadata in package.json
  * Update README before 1.0.0
