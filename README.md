# Synapse

**Synapse** is a powerful, cross-platform desktop application for running AI models locally. Built with Electron, React, and TypeScript, it provides a user-friendly interface for chatting with local AI models while offering advanced features like profile management, hardware detection, and tool calling capabilities.

## Features

### Core Functionality
- **Local AI Model Execution**: Run AI models directly on your machine for privacy and low-latency responses
- **Chat Interface**: Intuitive chat UI with support for tool calls and extended conversation contexts
- **Model Management**: Browse, download, and manage AI models with automatic profile creation
- **Profile System**: Create and customize chat profiles with different model configurations, system prompts, and temperature settings

### Advanced Features
- **Hardware Detection**: Automatic detection of CPU, RAM, and GPU/VRAM to recommend optimal model configurations
- **Tool Calling**: Built-in filesystem and Git tools for AI agents to interact with your local environment
- **Multi-Model Support**: Support for various model formats including GGUF
- **Settings Management**: Comprehensive settings for model parameters (temperature, top-k, top-p, min-p, seed, etc.)

### Technical Highlights
- **Electron + React + TypeScript**: Modern tech stack for cross-platform desktop development
- **WebGPU Support**: Leverages modern GPU acceleration for AI inference
- **IPC Communication**: Efficient main/renderer process communication via Electron IPC
- **State Management**: React Context and hooks for managing application state

## Getting Started

### Prerequisites
- Node.js 18+ and npm or yarn
- A modern system with at least 8GB RAM recommended
- GPU with WebGPU support (optional, for accelerated inference)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-repo/synapse.git
cd synapse
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

### Building for Production

To build the application for your platform:

```bash
npm run package
```

## Usage

### Chat
- Start a conversation with your selected AI model
- View tool calls with expandable details
- Copy responses and manage chat history

### Models
- Browse available AI models
- Download and install models automatically
- Create default profiles for new models

### Profiles
- Create custom chat profiles with specific model configurations
- Set system prompts for each profile
- Adjust model parameters (temperature, top-k, top-p, etc.)
- Import/export profiles

### Settings
- Configure model preferences
- Set hardware limits (RAM/VRAM allocation)
- Manage API keys (e.g., Hugging Face token)
- Configure auto-detection settings

## Architecture

```
src/
├── main/                 # Electron main process
│   ├── main.ts          # Main entry point
│   └── preload.ts       # Preload script for IPC
├── renderer/            # React renderer process
│   ├── pages/           # Application pages
│   │   ├── ChatPage.tsx
│   │   ├── ModelsPage.tsx
│   │   ├── ProfilesPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/      # Reusable React components
│   ├── styles/          # CSS modules
│   └── types/           # TypeScript type definitions
└── data/                # Static data files
    ├── defaultTools.ts  # Available AI tools
    └── languages.ts     # Language support
```

## Available Tools

Synapse includes built-in tools that AI models can use to interact with your system:

### Filesystem Tools
- `read_text_file`: Read text files with optional line ranges
- `read_media_file`: Read media files (images, videos, PDFs) as base64
- `read_multiple_files`: Read multiple text files simultaneously
- `write_file`: Write content to files
- `edit_file`: Edit files with text replacements
- `create_directory`: Create directories recursively
- `list_directory`: List directory contents
- `list_directory_with_sizes`: List with file sizes
- `move_file`: Move or rename files
- `search_files`: Search for files by glob pattern
- `directory_tree`: Generate directory tree view
- `get_file_info`: Get detailed file metadata
- `list_allowed_directories`: List configured allowed directories

### Git Tools
- `git_status`: Get repository working tree status
- `git_diff_unstaged`: Show unstaged changes
- `git_diff_staged`: Show staged changes
- `git_diff`: Compare against branches/commits
- `git_commit`: Commit staged changes
- `git_add`: Stage files for commit
- `git_reset`: Unstage all changes
- `git_log`: View commit history
- `git_create_branch`: Create new branch
- `git_checkout`: Switch branches
- `git_show`: Show commit contents
- `git_branch`: List branches

## Configuration

### Model Parameters
- **Temperature**: Controls randomness in responses (0.0-2.0)
- **Top-K**: Limits sampling to top K tokens (1-100)
- **Top-P**: Nucleus sampling threshold (0.0-1.0)
- **Min-P**: Minimum probability threshold
- **Seed**: Random seed for reproducibility

### Hardware Settings
- **RAM Allocation**: Recommended based on model size
- **VRAM Allocation**: For GPU-accelerated inference
- **GPU Selection**: Choose specific GPU for multi-GPU systems

## Development

### Scripts

```bash
# Development
npm start              # Start development server
npm run lint           # Run ESLint
npm run lint:fix       # Fix linting issues

# Build
npm run build          # Build for production
npm run build:main     # Build main process
npm run build:renderer # Build renderer process

# Package
npm run package        # Package application
```

### Project Structure
- `.erb/`: Electron React Boilerplate configuration
- `node_modules/`: Dependencies
- `public/`: Public assets
- `release/`: Build artifacts

## Roadmap

- [ ] Auto-detect and recommend optimal model settings on first boot
- [ ] Cache hardware configuration for faster startup
- [ ] Add support for more AI model formats
- [ ] Implement cloud model integration
- [ ] Add export/import for chat history
- [ ] Enhance tool calling with custom tool definitions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Electron](https://www.electronjs.org/) for the desktop framework
- [React](https://react.dev/) for the UI library
- [TypeScript](https://www.typescriptlang.org/) for type safety
- [WebGPU](https://gpuweb.github.io/gpuweb/) for GPU acceleration

---

**Built with ❤️ for the AI community**

For more information and documentation, please visit our [documentation](https://synapse-docs.com) (placeholder).
