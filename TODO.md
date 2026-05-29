# App:
  * Auto-updater from Releases

# Chat:
  * Set default model
  * Cancel model loading
  * Modal to select profile
  ## Tools
    * Redo Implementation (remove node-llama-cpp dependency)
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
  * Remove and replace penalize NewLine (it does nothing right now)
  * Add new settings for models, projectors, performance, etc [LLama Server Flags](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

# Settings:
  * Optional HF token
  * Models returned per API request
  * Caches RAM/VRAM config (slow to open)

# Maintenance:
  * Clear unnecessary packages
  * Update packages
  * Clean up ipc.ts, preload.ts, preload.d.ts
    * Remove unused
    * Organize existing into readable sections
  * Add file name as top comment to all files
  * Set up Metadata in package.json
