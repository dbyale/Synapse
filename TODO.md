# App:
  * Auto-updater from Releases
  * Correct topbar handler
  * Correct AppData directory
  * Naming and Metadata

# Chat:
  * Set default model
  * Cancel model loading
  * Modal to select profile
  ## Tools
    * Vector Icons Per-Tools
  ## Uploads
    * Add text-based filetypes to upload [File->MD](https://github.com/microsoft/markitdown)

# Models:
  * Search
    * Return more data per query (settings)
    * Check for equivelent HF Resolvers (higher API Limit)
      * Warn on other
        * Not sure what file is, will be treated as model

# Estimator:
  * Reports missing model
  * Reports model too large
  * Use parser on Models page remotely

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

# Settings:
  * Optional HF token
  * Models returned per API request
    * (Maybe limit those shown at a time?, Performance problems seem to stem from extreme amount of elements rendered)

# Maintenance:
  * Clear unnecessary packages
  * Update packages
  * Clean up ipc.ts, preload.ts, preload.d.ts
    * Remove unused
    * Organize existing into readable sections
  * Add file name as top comment to all files
  * Set up Metadata in package.json
  * Update README before 1.0.0

# Bugs:
  ## Chat
    * Backend does not reappear after switching pages
  ## Models
    * Projectors with same quant get deleted
    * Projectors with same quant believe they are same download
  ## Profiles
    * Hitting "save" prompts profile restart even when no settings changed
