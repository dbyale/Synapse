import { useState } from 'react';
import { X, Plus, Trash2, Check } from 'lucide-react';
import './styles/SystemPromptMenu.css';

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

interface SystemPromptMenuProps {
  prompts: SystemPrompt[];
  selectedPromptId: string | null;
  onClose: () => void;
  onSave: (prompts: SystemPrompt[]) => void;
  onSelect: (id: string | null) => void;
}

export default function SystemPromptMenu({
  prompts,
  selectedPromptId,
  onClose,
  onSave,
  onSelect,
}: SystemPromptMenuProps) {
  const [localPrompts, setLocalPrompts] = useState<SystemPrompt[]>(prompts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  const handleCreate = () => {
    const newPrompt: SystemPrompt = {
      id: Date.now().toString(),
      name: 'New Prompt',
      content: '',
      createdAt: Date.now(),
    };
    setLocalPrompts([...localPrompts, newPrompt]);
    setEditingId(newPrompt.id);
    setEditName(newPrompt.name);
    setEditContent(newPrompt.content);
  };

  const handleDelete = (id: string) => {
    const updated = localPrompts.filter((p) => p.id !== id);
    setLocalPrompts(updated);
    if (selectedPromptId === id) {
      onSelect(null);
    }
    if (editingId === id) {
      setEditingId(null);
    }
  };

  const handleEdit = (prompt: SystemPrompt) => {
    setEditingId(prompt.id);
    setEditName(prompt.name);
    setEditContent(prompt.content);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;

    const updated = localPrompts.map((p) =>
      p.id === editingId
        ? { ...p, name: editName.trim() || 'Unnamed', content: editContent }
        : p,
    );
    setLocalPrompts(updated);
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    // If it's a new prompt with empty content, remove it
    const prompt = localPrompts.find((p) => p.id === editingId);
    if (prompt && !prompt.name && !prompt.content) {
      setLocalPrompts(localPrompts.filter((p) => p.id !== editingId));
    }
    setEditingId(null);
  };

  const handleSaveAll = () => {
    onSave(localPrompts);
    onClose();
  };

  const handleSelect = (id: string) => {
    if (selectedPromptId === id) {
      onSelect(null); // Deselect
    } else {
      onSelect(id);
    }
  };

  return (
    <div className="system-prompt-overlay">
      <div className="system-prompt-menu">
        <div className="system-prompt-header">
          <h2>System Prompts</h2>
          <button
            type="button"
            className="system-prompt-close"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="system-prompt-content">
          {localPrompts.length === 0 ? (
            <div className="system-prompt-empty">
              <p>No system prompts yet. Create one to get started!</p>
            </div>
          ) : (
            <div className="system-prompt-list">
              {localPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`system-prompt-item ${
                    selectedPromptId === prompt.id
                      ? 'system-prompt-item--selected'
                      : ''
                  }`}
                >
                  {editingId === prompt.id ? (
                    <div className="system-prompt-edit">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Prompt name..."
                        className="system-prompt-edit-name"
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        placeholder="Enter your system prompt here..."
                        className="system-prompt-edit-content"
                        rows={6}
                      />
                      <div className="system-prompt-edit-actions">
                        <button
                          type="button"
                          className="btn-accent"
                          onClick={handleSaveEdit}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="system-prompt-item-header">
                      <div className="system-prompt-item-info">
                        <h3>{prompt.name}</h3>
                        <p>{prompt.content.substring(0, 100)}...</p>
                      </div>
                      <div className="system-prompt-item-actions">
                        <button
                          type="button"
                          className={`system-prompt-select-btn ${
                            selectedPromptId === prompt.id
                              ? 'system-prompt-select-btn--active'
                              : ''
                          }`}
                          onClick={() => handleSelect(prompt.id)}
                          title={
                            selectedPromptId === prompt.id
                              ? 'Active'
                              : 'Select this prompt'
                          }
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          className="system-prompt-action-btn"
                          onClick={() => handleEdit(prompt)}
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="system-prompt-action-btn system-prompt-action-btn--danger"
                          onClick={() => handleDelete(prompt.id)}
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="system-prompt-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCreate}
          >
            <Plus size={16} />
            New Prompt
          </button>
          <button type="button" className="btn-accent" onClick={handleSaveAll}>
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}
