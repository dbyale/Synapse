import { useEffect } from 'react';
import './App.css';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ChatPage from './pages/ChatPage';
import ModelsPage from './pages/ModelsPage';
import SettingsPage from './pages/SettingsPage';
import ProfilesPage from './pages/ProfilesPage';
import WorkflowsPage from './pages/WorkflowPage';
import ExtensionsPage from './pages/ExtensionsPage';
import { fetchExtensionData } from './utils/extensionData';

export default function App() {
  useEffect(() => {
    fetchExtensionData();
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ChatPage />} />
          <Route path="profiles" element={<ProfilesPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="extensions" element={<ExtensionsPage />} />
        </Route>
      </Routes>
    </Router>
  );
}
