Models:
  * Move installed models to front of Models page
  * Installed models
    * Give recommendations for 3 models if none installed
    * Link to search
    * Deleting model deletes MMPROJ addons
  * Search
    * Return more data per query
    * Tooltips for each quantization type + mmproj
    * Check for equivelent HF Resolvers (higher API Limit)
    * RAM/VRAM Auto compatibility checker
      * Show yellow in search if parameters (in B) > allocated RAM+VRAM
      * After quant loads (with sizes), show red for not fitting in allocation
      * Show yellow for not fitting fully in VRAM
      * For MMPROJ file downloads, pick a model that is already downloaded/downloading
        * Grey out downloads until an available model
        * Show red warning if not fit in total allocated with model
        * Show yellow if not fit in VRAM with model
      * Warn on other
        * Not sure what file is, will be treated as model


Settings:
  * Optional HF token
  * Models returned per API request
  * RAM/VRAM allocator
