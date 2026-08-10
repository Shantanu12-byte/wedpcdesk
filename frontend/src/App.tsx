import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DeckConfig, Profile, ButtonConfig, ServerState } from '../../shared/types';
import ButtonGrid from './components/ButtonGrid';
import EditModal from './components/EditModal';
import ConfirmModal from './components/ConfirmModal';
import { 
  getServerState, 
  pairWithCode, 
  getDeckConfig, 
  saveDeckConfig, 
  triggerAction,
  DeckSocket, 
  getPairingToken,
  clearPairingToken
} from './utils/api';
import { 
  Settings, 
  Play, 
  Smartphone, 
  LogOut, 
  Plus, 
  Download, 
  Upload, 
  Trash2, 
  Wifi,
  WifiOff
} from 'lucide-react';

interface Toast {
  id: string;
  type: 'success' | 'error';
  message: string;
}

const App: React.FC = () => {
  const [isLocal, setIsLocal] = useState(true);
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [config, setConfig] = useState<DeckConfig | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(false);
  
  // Auth state
  const [isPaired, setIsPaired] = useState(true);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  
  // Modals state
  const [activeCellCoord, setActiveCellCoord] = useState<string | null>(null);
  const [editingButton, setEditingButton] = useState<ButtonConfig | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  const [pendingButtonAction, setPendingButtonAction] = useState<ButtonConfig | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileRows, setNewProfileRows] = useState(3);
  const [newProfileCols, setNewProfileCols] = useState(5);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<DeckSocket | null>(null);

  // Toast Helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // 1. Initial State Fetch
  const checkStatus = async () => {
    try {
      const state = await getServerState();
      setServerState(state);
      setIsLocal(state.isLocal);

      if (!state.isLocal) {
        // If external client, check if paired
        const token = getPairingToken();
        if (!token) {
          setIsPaired(false);
          return;
        }
      }
      
      // Load config if local or already paired
      const deckConfig = await getDeckConfig();
      setConfig(deckConfig);
      setIsPaired(true);
    } catch (err) {
      console.error('Failed to connect to backend:', err);
      // For remote clients, verify token check failed
      if (getPairingToken()) {
        clearPairingToken();
        setIsPaired(false);
      }
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  // 2. Initialize WebSocket once paired/loaded (only for real-time config sync)
  useEffect(() => {
    if (!isPaired) return;

    const deckSocket = new DeckSocket(
      (msg) => {
        if (msg.type === 'init' || msg.type === 'config_update') {
          setConfig(msg.config);
        } else if (msg.type === 'action_result') {
          if (!msg.success) {
            showToast(`Action failed: ${msg.error || 'Unknown error'}`, 'error');
          }
        }
      },
      (connected) => {
        setIsWsConnected(connected);
      }
    );

    socketRef.current = deckSocket;

    return () => {
      deckSocket.disconnect();
      socketRef.current = null;
    };
  }, [isPaired]);

  // Handle Pairing submission
  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await pairWithCode(pairingCodeInput);
      if (result.success) {
        setIsPaired(true);
        showToast('Successfully paired!', 'success');
        // Trigger config load
        const deckConfig = await getDeckConfig();
        setConfig(deckConfig);
      }
    } catch (err: any) {
      showToast(err.message || 'Incorrect pairing code', 'error');
    }
  };

  // Handle Action Trigger (from grid button click)
  const handleExecuteAction = (btn: ButtonConfig) => {
    if (btn.confirmBeforeRun) {
      setPendingButtonAction(btn);
      setIsConfirmModalOpen(true);
    } else {
      executeActionNow(btn);
    }
  };

  // Always use HTTP POST for action triggering — avoids stale WS state entirely
  const executeActionNow = useCallback(async (btn: ButtonConfig) => {
    console.log('[DEBUG-App] executeActionNow called for button:', btn.id, 'action:', btn.action);
    try {
      await triggerAction(btn.action);
      console.log('[DEBUG-App] triggerAction completed successfully.');
    } catch (err: any) {
      console.error('[DEBUG-App] triggerAction failed:', err);
      showToast(`Action failed: ${err.message || 'Unknown error'}`, 'error');
    }
  }, []);

  // Modify Button configuration
  const handleConfigureButton = (coordinate: string, btn: ButtonConfig | null) => {
    setActiveCellCoord(coordinate);
    setEditingButton(btn);
    setIsEditModalOpen(true);
  };

  const handleSaveButton = async (updatedBtn: ButtonConfig) => {
    if (!config || !activeCellCoord) return;

    const activeProfile = config.profiles.find(p => p.id === config.activeProfileId);
    if (!activeProfile) return;

    const updatedButtons = { ...activeProfile.buttons, [activeCellCoord]: updatedBtn };
    const updatedProfiles = config.profiles.map(p => 
      p.id === config.activeProfileId ? { ...p, buttons: updatedButtons } : p
    );

    const newConfig = { ...config, profiles: updatedProfiles };
    
    try {
      setConfig(newConfig);
      await saveDeckConfig(newConfig);
      setIsEditModalOpen(false);
      showToast('Button updated successfully', 'success');
    } catch (err) {
      showToast('Failed to save configuration', 'error');
    }
  };

  const handleDeleteButton = async () => {
    if (!config || !activeCellCoord) return;

    const activeProfile = config.profiles.find(p => p.id === config.activeProfileId);
    if (!activeProfile) return;

    const updatedButtons = { ...activeProfile.buttons };
    delete updatedButtons[activeCellCoord];

    const updatedProfiles = config.profiles.map(p => 
      p.id === config.activeProfileId ? { ...p, buttons: updatedButtons } : p
    );

    const newConfig = { ...config, profiles: updatedProfiles };

    try {
      setConfig(newConfig);
      await saveDeckConfig(newConfig);
      setIsEditModalOpen(false);
      showToast('Button deleted', 'success');
    } catch (err) {
      showToast('Failed to delete button', 'error');
    }
  };

  const handleUpdateButtonsDirectly = async (newButtons: Record<string, ButtonConfig>) => {
    if (!config) return;
    const updatedProfiles = config.profiles.map(p => 
      p.id === config.activeProfileId ? { ...p, buttons: newButtons } : p
    );
    const newConfig = { ...config, profiles: updatedProfiles };
    setConfig(newConfig);
    try {
      await saveDeckConfig(newConfig);
    } catch (err) {
      showToast('Failed to save grid reorder', 'error');
    }
  };

  // Profile Management
  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || !newProfileName.trim()) return;

    const newProfile: Profile = {
      id: `profile_${Date.now()}`,
      name: newProfileName,
      rows: newProfileRows,
      cols: newProfileCols,
      buttons: {},
    };

    const newConfig = {
      ...config,
      profiles: [...config.profiles, newProfile],
      activeProfileId: newProfile.id,
    };

    try {
      setConfig(newConfig);
      await saveDeckConfig(newConfig);
      setIsProfileModalOpen(false);
      setNewProfileName('');
      showToast(`Profile "${newProfile.name}" created`, 'success');
    } catch (err) {
      showToast('Failed to create profile', 'error');
    }
  };

  const handleDeleteProfile = async () => {
    if (!config) return;
    if (config.profiles.length <= 1) {
      showToast('Cannot delete the last remaining profile', 'error');
      return;
    }

    const filtered = config.profiles.filter(p => p.id !== config.activeProfileId);
    const newConfig = {
      ...config,
      profiles: filtered,
      activeProfileId: filtered[0].id,
    };

    if (window.confirm('Are you sure you want to delete this entire profile? All buttons inside it will be lost.')) {
      try {
        setConfig(newConfig);
        await saveDeckConfig(newConfig);
        showToast('Profile deleted', 'success');
      } catch (err) {
        showToast('Failed to delete profile', 'error');
      }
    }
  };

  // Import / Export
  const handleExportConfig = () => {
    if (!config) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `macro-deck-config.json`);
    dlAnchorElem.click();
    showToast('Configuration exported', 'success');
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const file = e.target.files?.[0];
    if (!file) return;

    fileReader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as DeckConfig;
        if (parsed && Array.isArray(parsed.profiles) && parsed.activeProfileId) {
          setConfig(parsed);
          await saveDeckConfig(parsed);
          showToast('Configuration imported successfully!', 'success');
        } else {
          showToast('Invalid file structure', 'error');
        }
      } catch (err) {
        showToast('Failed to read config file', 'error');
      }
    };
    fileReader.readAsText(file);
  };

  const activeProfile = config?.profiles.find(p => p.id === config.activeProfileId);

  // Render Pairing Interface on Mobile/Remote if not paired
  if (!isPaired) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <form onSubmit={handlePairSubmit} className="glass" style={{ width: '100%', maxWidth: '380px', padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎛️</div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Pair Remote Deck</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px', lineHeight: '1.5' }}>
            Enter the 6-digit pairing code shown on your laptop screen.
          </p>

          <input
            type="text"
            placeholder="000000"
            value={pairingCodeInput}
            onChange={(e) => setPairingCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ 
              textAlign: 'center', 
              fontSize: '32px', 
              letterSpacing: '8px', 
              fontWeight: 700, 
              padding: '12px',
              marginBottom: '24px'
            }}
          />

          <button type="submit" className="btn btn-primary" style={{ width: '100%', fontSize: '16px', padding: '12px' }}>
            Pair Device
          </button>
        </form>

        {/* Toasts */}
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.type === 'error' ? 'toast-error' : 'toast-success'}`}>
              {t.message}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header Panel */}
      <header className="glass" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>🎛️</span>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.5px' }}>WebPCDeck</h1>
            <span style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: isWsConnected ? 'var(--success)' : 'var(--text-muted)' }}>
              {isWsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {isWsConnected ? 'Connected to Host' : 'Reconnecting...'}
            </span>
          </div>
        </div>

        {/* Profile Tabs */}
        {config && (
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
            {config.profiles.map(p => (
              <button
                key={p.id}
                onClick={async () => {
                  const newCfg = { ...config, activeProfileId: p.id };
                  setConfig(newCfg);
                  await saveDeckConfig(newCfg);
                }}
                style={{
                  background: config.activeProfileId === p.id ? 'var(--primary)' : 'rgba(255,255,255,0.03)',
                  color: config.activeProfileId === p.id ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: '8px 14px',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  transition: 'all var(--transition-fast)'
                }}
              >
                {p.name}
              </button>
            ))}

            {isEditMode && (
              <button 
                onClick={() => setIsProfileModalOpen(true)}
                style={{ background: 'none', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)', padding: '6px 10px', borderRadius: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Plus size={14} /> New
              </button>
            )}
          </div>
        )}

        {/* Global actions (Toggle Edit mode, Connection detail) */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isEditMode && activeProfile && (
            <button 
              onClick={handleDeleteProfile} 
              className="btn" 
              style={{ background: 'none', border: 'none', color: 'var(--danger)', padding: '8px' }}
              title="Delete Profile"
            >
              <Trash2 size={18} />
            </button>
          )}

          <button 
            className={`btn ${isEditMode ? 'btn-primary pulse-primary' : 'btn-secondary'}`}
            onClick={() => setIsEditMode(!isEditMode)}
            style={{ fontSize: '13px' }}
          >
            {isEditMode ? <Play size={15} /> : <Settings size={15} />}
            {isEditMode ? 'Run Mode' : 'Edit Layout'}
          </button>

          {!isLocal && (
            <button 
              onClick={() => {
                clearPairingToken();
                setIsPaired(false);
              }}
              className="btn btn-secondary"
              style={{ padding: '8px', color: 'var(--danger)' }}
              title="Unpair"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Main Grid View */}
      {activeProfile ? (
        <main className="glass" style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <ButtonGrid
            profile={activeProfile}
            isEditMode={isEditMode}
            onExecute={handleExecuteAction}
            onConfigureButton={handleConfigureButton}
            onUpdateButtons={handleUpdateButtonsDirectly}
          />
        </main>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px' }}>Loading configuration...</div>
      )}

      {/* Footer / Connection Panel (Only shown on Desktop host) */}
      {isLocal && serverState && (
        <footer className="glass" style={{ marginTop: '24px', padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <Smartphone size={14} />
              <span>Mobile access:</span>
              <strong style={{ color: 'var(--primary)' }}>http://{serverState.lanIp}:{serverState.port}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>Pairing Code:</span>
              <span 
                style={{ 
                  backgroundColor: 'rgba(99, 102, 241, 0.1)', 
                  border: '1px solid var(--primary-glow)', 
                  padding: '2px 8px', 
                  borderRadius: '4px', 
                  fontWeight: 700, 
                  color: 'var(--primary)',
                  letterSpacing: '1px'
                }}
              >
                {serverState.pairingCode}
              </span>
            </div>
          </div>

          {/* Import / Export Settings */}
          {isEditMode && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={handleExportConfig}>
                <Download size={14} /> Export Config
              </button>
              
              <label className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px 12px', cursor: 'pointer' }}>
                <Upload size={14} /> Import Config
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={handleImportConfig} 
                  style={{ display: 'none' }} 
                />
              </label>
            </div>
          )}
        </footer>
      )}

      {/* MODALS */}
      <EditModal
        isOpen={isEditModalOpen}
        button={editingButton}
        onSave={handleSaveButton}
        onDelete={handleDeleteButton}
        onClose={() => setIsEditModalOpen(false)}
      />

      <ConfirmModal
        isOpen={isConfirmModalOpen}
        title="Confirm Action"
        message={`Are you sure you want to trigger "${pendingButtonAction?.label || 'this action'}"? This will modify your system state.`}
        onConfirm={() => {
          if (pendingButtonAction) executeActionNow(pendingButtonAction);
          setIsConfirmModalOpen(false);
          setPendingButtonAction(null);
        }}
        onClose={() => {
          setIsConfirmModalOpen(false);
          setPendingButtonAction(null);
        }}
      />

      {/* Profile Create Modal */}
      {isProfileModalOpen && (
        <div className="modal-overlay">
          <form onSubmit={handleCreateProfile} className="modal-content glass" style={{ maxWidth: '400px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>Create Profile</h2>
            
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Profile Name</label>
              <input 
                type="text" 
                value={newProfileName} 
                onChange={(e) => setNewProfileName(e.target.value)} 
                placeholder="e.g. Work, Gaming" 
                required 
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Rows</label>
                <input 
                  type="number" 
                  min={1} 
                  max={6} 
                  value={newProfileRows} 
                  onChange={(e) => setNewProfileRows(Number(e.target.value))} 
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Columns</label>
                <input 
                  type="number" 
                  min={1} 
                  max={10} 
                  value={newProfileCols} 
                  onChange={(e) => setNewProfileCols(Number(e.target.value))} 
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsProfileModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TOAST NOTIFICATION CONTAINER */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type === 'error' ? 'toast-error' : 'toast-success'}`}>
            {t.message}
          </div>
        ))}
      </div>

    </div>
  );
};

export default App;
