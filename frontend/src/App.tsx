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
  Trash2
} from 'lucide-react';

interface Toast {
  id: string;
  type: 'success' | 'error';
  message: string;
}

const App: React.FC = () => {
  const [isLocal, setIsLocal] = useState(() => {
    const host = window.location.hostname;
    return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  });
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [config, setConfig] = useState<DeckConfig | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(false);
  
  // Auth state
  const [isPaired, setIsPaired] = useState(() => {
    const host = window.location.hostname;
    const local = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!local) {
      return !!(localStorage.getItem('webpcdeck_token') && localStorage.getItem('webpcdeck_backend_ip'));
    }
    return true;
  });

  const [pcIpInput, setPcIpInput] = useState(localStorage.getItem('webpcdeck_backend_ip') || '');
  
  // Custom pairing input digits and state
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [isPairingLoading, setIsPairingLoading] = useState(false);
  const [hasValidationError, setHasValidationError] = useState(false);
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  
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

  const [isFooterOpen, setIsFooterOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

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
      let state = null;
      let localDetected = false;

      // First, try connecting to the local backend directly on localhost
      try {
        const localRes = await fetch('http://localhost:5001/api/state');
        if (localRes.ok) {
          state = await localRes.json();
          localDetected = true;
        }
      } catch (e) {
        // Local backend not running on this machine (normal for phones/remote browsers)
      }

      // Fallback to configured base URL if localhost check didn't succeed
      if (!state) {
        state = await getServerState();
      }

      setServerState(state);
      const isLocalMode = localDetected || state.isLocal;
      setIsLocal(isLocalMode);

      if (!isLocalMode) {
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
      const host = window.location.hostname;
      const local = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
      if (!local) {
        setIsPaired(false);
      } else if (getPairingToken()) {
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

  // Handle Digit Key Event for Backspace navigation
  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    }
  };

  // Handle Digit Change
  const handleDigitChange = (index: number, val: string) => {
    const cleanVal = val.replace(/\D/g, '').slice(-1);
    const newDigits = [...codeDigits];
    newDigits[index] = cleanVal;
    setCodeDigits(newDigits);

    // Auto-advance focus to next box
    if (cleanVal && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit if completely filled
    if (newDigits.every(d => d !== '') && newDigits.join('').length === 6) {
      const code = newDigits.join('');
      setTimeout(() => pairDirectly(code), 50);
    }
  };

  // Unified direct pairing mechanism
  const pairDirectly = async (code: string) => {
    setIsPairingLoading(true);
    setHasValidationError(false);
    try {
      if (!isLocal && pcIpInput.trim()) {
        localStorage.setItem('webpcdeck_backend_ip', pcIpInput.trim());
      }
      const result = await pairWithCode(code);
      if (result.success) {
        setIsPaired(true);
        showToast('Successfully paired!', 'success');
        const deckConfig = await getDeckConfig();
        setConfig(deckConfig);
      }
    } catch (err: any) {
      if (!isLocal) {
        localStorage.removeItem('webpcdeck_backend_ip');
      }
      setHasValidationError(true);
      setTimeout(() => setHasValidationError(false), 500);
      showToast(err.message || 'Incorrect pairing code', 'error');
    } finally {
      setIsPairingLoading(false);
    }
  };

  // Handle Pairing submission (fallback for form button)
  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = codeDigits.join('');
    if (code.length === 6) {
      pairDirectly(code);
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
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '16px', position: 'relative', overflow: 'hidden' }}>
        <div className="accent-bloom-glow" style={{ top: '30%', left: '50%', transform: 'translate(-50%, -50%)' }} />
        
        <form 
          onSubmit={handlePairSubmit} 
          className={`glass ${hasValidationError ? 'shake-error' : ''}`} 
          style={{ 
            width: '100%', 
            maxWidth: '400px', 
            padding: '40px 32px', 
            textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
            transition: 'all 0.3s ease'
          }}
        >
          <div style={{ fontSize: '56px', marginBottom: '20px', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))' }}>🎛️</div>
          <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px', letterSpacing: '-0.5px' }}>Pair Remote Deck</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', marginBottom: '28px', lineHeight: '1.6' }}>
            Enter the 6-digit pairing code shown on your laptop screen.
          </p>

          {!isLocal && (
            <div style={{ marginBottom: '24px', textAlign: 'left' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>PC IP / URL Address</label>
              <input
                type="text"
                placeholder="e.g. rocket-suitably-modular.ngrok-free.dev"
                value={pcIpInput}
                onChange={(e) => setPcIpInput(e.target.value.trim())}
                style={{ 
                  fontFamily: 'monospace',
                  fontSize: '14px', 
                  padding: '12px 14px',
                  width: '100%',
                  borderRadius: '10px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  transition: 'all var(--transition-fast)'
                }}
                required
              />
            </div>
          )}

          <div style={{ marginBottom: '28px', textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pairing Code</label>
            <div className="code-digits-container">
              {codeDigits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={el => digitInputRefs.current[idx] = el}
                  type="text"
                  pattern="\d*"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                  className="code-digit-input"
                  style={{
                    borderColor: hasValidationError ? 'var(--danger)' : undefined
                  }}
                />
              ))}
            </div>
          </div>

          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={isPairingLoading || codeDigits.some(d => d === '')}
            style={{ 
              width: '100%', 
              fontSize: '15px', 
              padding: '14px', 
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              boxShadow: '0 4px 20px rgba(99, 102, 241, 0.25)'
            }}
          >
            {isPairingLoading ? (
              <>
                <div className="spinner" />
                Pairing...
              </>
            ) : (
              'Pair Device'
            )}
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
            <h1 style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.5px' }}>WebPCDeck</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <div className={`pulse-dot ${isWsConnected ? '' : 'reconnecting'}`} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: isWsConnected ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {isWsConnected ? 'Connected' : 'Reconnecting...'}
              </span>
            </div>
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
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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

          {/* Two-state Layout Toggle Switch */}
          <div className="toggle-switch-container">
            <button 
              className={`toggle-switch-option ${!isEditMode ? 'active' : ''}`}
              onClick={() => setIsEditMode(false)}
            >
              <Play size={13} />
              Run
            </button>
            <button 
              className={`toggle-switch-option ${isEditMode ? 'active' : ''}`}
              onClick={() => setIsEditMode(true)}
            >
              <Settings size={13} />
              Edit
            </button>
          </div>

          {!isLocal && (
            <button 
              onClick={() => {
                if (window.confirm('Are you sure you want to unpair from this PC?')) {
                  clearPairingToken();
                  localStorage.removeItem('webpcdeck_backend_ip');
                  setPcIpInput('');
                  setIsPaired(false);
                }
              }}
              className="btn btn-secondary"
              style={{ padding: '8px', color: 'var(--danger)', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.05)' }}
              title="Unpair"
            >
              <LogOut size={15} />
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
        <footer 
          className={`glass host-footer-drawer ${isFooterOpen ? 'open' : ''}`} 
          style={{ 
            marginTop: '24px', 
            border: '1px solid var(--border-color)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            borderRadius: '16px',
            background: 'rgba(20, 24, 33, 0.7)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Drawer Header */}
          <div 
            onClick={() => setIsFooterOpen(!isFooterOpen)}
            style={{ 
              padding: '14px 20px', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              cursor: 'pointer',
              userSelect: 'none',
              borderBottom: isFooterOpen ? '1px solid var(--border-color)' : 'none',
              transition: 'border-bottom var(--transition-fast)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Smartphone size={16} style={{ color: 'var(--primary)' }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Host Server Status</span>
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '5px', 
                  background: 'rgba(34, 197, 94, 0.08)', 
                  padding: '2px 8px', 
                  borderRadius: '12px',
                  border: '1px solid rgba(34, 197, 94, 0.15)'
                }}
              >
                <div className="pulse-dot" style={{ width: '6px', height: '6px' }} />
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--success)' }}>Running</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {serverState.connectedClients} Client{serverState.connectedClients !== 1 ? 's' : ''} Connected
              </span>
              <span style={{ color: 'var(--text-secondary)', transition: 'transform 0.3s', transform: isFooterOpen ? 'rotate(180deg)' : 'none', fontSize: '10px' }}>▼</span>
            </div>
          </div>

          {/* Drawer Content */}
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Left: Pairing Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Pairing Code</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span 
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(serverState.pairingCode);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      } catch (err) {}
                    }}
                    style={{ 
                      fontFamily: 'monospace',
                      fontSize: '22px',
                      fontWeight: 800,
                      color: 'var(--primary)',
                      background: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid var(--primary-glow)',
                      padding: '4px 14px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      letterSpacing: '2px',
                      transition: 'all var(--transition-fast)',
                    }}
                    title="Click to copy"
                  >
                    {serverState.pairingCode}
                  </span>
                  {copiedCode && <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 600 }}>Copied ✓</span>}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Click to copy code to clipboard</span>
              </div>

              {/* Right: Network Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Direct Mobile Access</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <code style={{ fontSize: '13px', background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', color: '#fff' }}>
                    http://{serverState.lanIp}:{serverState.port}
                  </code>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Open on your phone to connect over Wi-Fi</span>
              </div>
            </div>

            {/* Clients Listing */}
            {serverState.connectedClients > 0 && (
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Connected Devices</span>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {Array.from({ length: serverState.connectedClients }).map((_, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        background: 'rgba(255,255,255,0.02)', 
                        border: '1px solid var(--border-color)', 
                        padding: '8px 12px', 
                        borderRadius: '10px' 
                      }}
                    >
                      <Smartphone size={14} style={{ color: 'var(--text-secondary)' }} />
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Remote Client #{idx + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Import / Export Settings */}
            {isEditMode && (
              <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '8px 14px', borderRadius: '8px' }} onClick={handleExportConfig}>
                  <Download size={14} /> Export Config
                </button>
                
                <label className="btn btn-secondary" style={{ fontSize: '12px', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer' }}>
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
          </div>
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
