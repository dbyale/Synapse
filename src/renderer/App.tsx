import { useEffect } from 'react';
import './App.css';
import { MemoryRouter as Router, Routes, Route } from 'react-router';
import Layout from './components/Layout';
import ModelsPage from './pages/ModelsPage';
import SettingsPage from './pages/SettingsPage';
import ProfilesPage from './pages/ProfilesPage';
import WorkflowsPage from './pages/WorkflowPage';
import ExtensionsPage from './pages/ExtensionsPage';
import { fetchExtensionData } from './utils/extensionData';
import Onboarding from './onboarding/Onboarding';

export default function App() {
  useEffect(() => {
    fetchExtensionData();
  }, []);

  useEffect(() => {
    let focusedEditable: HTMLElement | null = null;

    const notify = () => {
      const el = document.activeElement as HTMLElement | null;
      const isInput =
        !!el &&
        (el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLInputElement && !el.readOnly));
      const isEditable = !!el && (isInput || el.isContentEditable);

      let inputSelection = false;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        inputSelection = el.selectionStart !== el.selectionEnd;
      }

      const docSel = window.getSelection();
      const docSelection =
        !!docSel && docSel.rangeCount > 0 && !docSel.isCollapsed;

      const editableSelection = isInput ? inputSelection : docSelection;
      const anySelection = inputSelection || docSelection;

      window.electronAPI.notifyMenuEditState({
        canCopy: anySelection,
        canCut: isEditable && editableSelection,
        canDelete: isEditable && editableSelection,
        canPaste: isEditable,
      });
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target instanceof HTMLTextAreaElement ||
          target instanceof HTMLInputElement ||
          target.isContentEditable)
      ) {
        focusedEditable?.removeEventListener('selectionchange', notify);
        target.addEventListener('selectionchange', notify);
        focusedEditable = target;
      }
      notify();
    };

    const handleFocusOut = () => {
      focusedEditable?.removeEventListener('selectionchange', notify);
      focusedEditable = null;
      notify();
    };

    notify();
    document.addEventListener('selectionchange', notify);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    window.addEventListener('focus', notify);

    return () => {
      focusedEditable?.removeEventListener('selectionchange', notify);
      document.removeEventListener('selectionchange', notify);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('focus', notify);
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<div />} />
          <Route path="chat" element={<div />} />
          <Route path="profiles" element={<ProfilesPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="extensions" element={<ExtensionsPage />} />
        </Route>
      </Routes>
      <Onboarding />
    </Router>
  );
}
