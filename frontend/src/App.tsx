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
  clearPairingToken,
  getPerformanceMetrics,
  PerformanceData
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
  LayoutGrid,
  Activity
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

  const [activeSection, setActiveSection] = useState<'controls' | 'performance' | 'settings'>('controls');
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [isMobileScreen, setIsMobileScreen] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (activeSection !== 'performance' || !isPaired) {
      setPerfData(null);
      return;
    }

    let active = true;
    const fetchMetrics = async () => {
      try {
        const data = await getPerformanceMetrics();
        if (active) {
          setPerfData(data);
        }
      } catch (err) {
        console.error('Failed to fetch performance metrics:', err);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeSection, isPaired]);

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

  const handleDeleteProfileById = async (profileId: string) => {
    if (!config) return;
    if (config.profiles.length <= 1) {
      showToast('Cannot delete the last remaining profile', 'error');
      return;
    }
    const profileToDelete = config.profiles.find(p => p.id === profileId);
    if (!profileToDelete) return;
    
    if (window.confirm(`Are you sure you want to delete profile "${profileToDelete.name}"?`)) {
      const filtered = config.profiles.filter(p => p.id !== profileId);
      const activeId = config.activeProfileId === profileId ? filtered[0].id : config.activeProfileId;
      const newConfig = {
        ...config,
        profiles: filtered,
        activeProfileId: activeId,
      };

      try {
        setConfig(newConfig);
        await saveDeckConfig(newConfig);
        showToast('Profile deleted successfully', 'success');
      } catch (err) {
        showToast('Failed to delete profile', 'error');
      }
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
    <div style={{ display: 'flex', flexDirection: isMobileScreen ? 'column-reverse' : 'row', minHeight: '100vh', background: '#0b0e14', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Sidebar Nav */}
      <aside 
        style={isMobileScreen ? {
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '64px',
          background: 'rgba(18, 20, 26, 0.95)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          padding: '0 16px',
          zIndex: 100
        } : {
          width: '240px', 
          background: '#12141a', 
          borderRight: '1px solid rgba(255, 255, 255, 0.05)', 
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flexShrink: 0
        }}
      >
        {!isMobileScreen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            {/* Logo / Brand Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '8px' }}>
              <span style={{ fontSize: '28px' }}>🎛️</span>
              <div>
                <h1 style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>WebPCDeck</h1>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>PC Control Center</span>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Options */}
        <nav style={{ 
          display: 'flex', 
          flexDirection: isMobileScreen ? 'row' : 'column', 
          gap: isMobileScreen ? '16px' : '6px',
          width: isMobileScreen ? '100%' : 'auto',
          justifyContent: isMobileScreen ? 'space-around' : 'flex-start'
        }}>
          <button 
            onClick={() => setActiveSection('controls')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isMobileScreen ? 'center' : 'flex-start',
              gap: '12px',
              padding: isMobileScreen ? '8px 16px' : '12px 14px',
              borderRadius: '10px',
              background: activeSection === 'controls' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              color: activeSection === 'controls' ? '#fff' : '#8f95a5',
              border: 'none',
              borderLeft: (!isMobileScreen && activeSection === 'controls') ? '3px solid var(--primary)' : '3px solid transparent',
              borderBottom: (isMobileScreen && activeSection === 'controls') ? '3px solid var(--primary)' : '3px solid transparent',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              transition: 'all 0.2s',
              flex: isMobileScreen ? 1 : 'none'
            }}
          >
            <LayoutGrid size={16} />
            {!isMobileScreen && 'Controls'}
          </button>

          <button 
            onClick={() => setActiveSection('performance')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isMobileScreen ? 'center' : 'flex-start',
              gap: '12px',
              padding: isMobileScreen ? '8px 16px' : '12px 14px',
              borderRadius: '10px',
              background: activeSection === 'performance' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              color: activeSection === 'performance' ? '#fff' : '#8f95a5',
              border: 'none',
              borderLeft: (!isMobileScreen && activeSection === 'performance') ? '3px solid var(--primary)' : '3px solid transparent',
              borderBottom: (isMobileScreen && activeSection === 'performance') ? '3px solid var(--primary)' : '3px solid transparent',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              transition: 'all 0.2s',
              flex: isMobileScreen ? 1 : 'none'
            }}
          >
            <Activity size={16} />
            {!isMobileScreen && 'Performance'}
          </button>

          <button 
            onClick={() => setActiveSection('settings')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isMobileScreen ? 'center' : 'flex-start',
              gap: '12px',
              padding: isMobileScreen ? '8px 16px' : '12px 14px',
              borderRadius: '10px',
              background: activeSection === 'settings' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              color: activeSection === 'settings' ? '#fff' : '#8f95a5',
              border: 'none',
              borderLeft: (!isMobileScreen && activeSection === 'settings') ? '3px solid var(--primary)' : '3px solid transparent',
              borderBottom: (isMobileScreen && activeSection === 'settings') ? '3px solid var(--primary)' : '3px solid transparent',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              transition: 'all 0.2s',
              flex: isMobileScreen ? 1 : 'none'
            }}
          >
            <Settings size={16} />
            {!isMobileScreen && 'Settings'}
          </button>
        </nav>

        {/* Sidebar Unpair Button */}
        {!isMobileScreen && !isLocal && (
          <button 
            onClick={() => {
              if (window.confirm('Are you sure you want to unpair from this PC?')) {
                clearPairingToken();
                localStorage.removeItem('webpcdeck_backend_ip');
                setPcIpInput('');
                setIsPaired(false);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              background: 'rgba(239, 68, 68, 0.04)',
              color: '#ef4444',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
              transition: 'background var(--transition-fast)'
            }}
          >
            <LogOut size={14} />
            Unpair Device
          </button>
        )}
      </aside>

      {/* Content Pane */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        padding: isMobileScreen ? '16px' : '24px 32px', 
        paddingBottom: isMobileScreen ? '80px' : '24px', 
        overflowY: 'auto' 
      }}>
        
        {/* Top Header Bar */}
        <header 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            paddingBottom: '16px', 
            marginBottom: '24px', 
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)' 
          }}
        >
          {/* Connection Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className={`pulse-dot ${isWsConnected ? '' : 'reconnecting'}`} style={{ width: '6px', height: '6px' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: isWsConnected ? '#e2e8f0' : 'var(--text-muted)' }}>
              {isWsConnected ? 'Connected to PC' : 'Reconnecting...'}
            </span>
          </div>

          {/* Run/Edit Mode Controls */}
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            {config && (
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Profile: {config.profiles.find(p => p.id === config.activeProfileId)?.name}
              </span>
            )}
            
            <div className="toggle-switch-container">
              <button 
                className={`toggle-switch-option ${!isEditMode ? 'active' : ''}`}
                onClick={() => setIsEditMode(false)}
              >
                <Play size={12} />
                Run
              </button>
              <button 
                className={`toggle-switch-option ${isEditMode ? 'active' : ''}`}
                onClick={() => setIsEditMode(true)}
              >
                <Settings size={12} />
                Edit
              </button>
            </div>
          </div>
        </header>

        {/* Controls Screen */}
        {activeSection === 'controls' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', flex: 1 }}>
            


            {/* Profiles switch tabs (Only in Edit mode) */}
            {isEditMode && config && (
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.03)', padding: '8px 0' }}>
                {config.profiles.map(p => (
                  <button
                    key={p.id}
                    onClick={async () => {
                      const newCfg = { ...config, activeProfileId: p.id };
                      setConfig(newCfg);
                      await saveDeckConfig(newCfg);
                    }}
                    style={{
                      background: config.activeProfileId === p.id ? '#181a1e' : 'rgba(255,255,255,0.02)',
                      color: config.activeProfileId === p.id ? '#fff' : 'var(--text-secondary)',
                      border: config.activeProfileId === p.id ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid rgba(255,255,255,0.05)',
                      boxShadow: config.activeProfileId === p.id ? '0 0 12px -2px rgba(99, 102, 241, 0.2)' : 'none',
                      padding: '6px 12px',
                      borderRadius: '16px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      transition: 'all var(--transition-fast)'
                    }}
                  >
                    {p.name}
                  </button>
                ))}
                <button 
                  onClick={() => setIsProfileModalOpen(true)}
                  style={{ background: 'none', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)', padding: '4px 10px', borderRadius: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                >
                  <Plus size={12} /> New
                </button>
              </div>
            )}

            {/* Main Button Grid */}
            {activeProfile ? (
              <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
          </div>
        )}
        {activeSection === 'performance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>System Performance</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
              
              {/* CPU load widget */}
              <div className="glass" style={{ padding: '24px', borderRadius: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '24px' }}>
                {/* CPU gauge circle SVG */}
                <div style={{ position: 'relative', width: '90px', height: '90px' }}>
                  <svg width="90" height="90" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="rgba(255,255,255,0.04)"
                      strokeWidth="3.5"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="3.5"
                      strokeDasharray={`${perfData ? perfData.cpu : 0}, 100`}
                      style={{ transition: 'stroke-dasharray 0.5s ease-out' }}
                    />
                  </svg>
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '18px', fontWeight: 800 }}>{perfData ? `${perfData.cpu}%` : '--'}</span>
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 4px 0' }}>CPU Load</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>
                    Real-time host processor load utilization
                  </p>
                </div>
              </div>

              {/* Memory load widget */}
              <div className="glass" style={{ padding: '24px', borderRadius: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 4px 0' }}>Memory Usage</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: 0 }}>
                      {perfData ? `${(perfData.usedMem / (1024 * 1024 * 1024)).toFixed(1)} GB / ${(perfData.totalMem / (1024 * 1024 * 1024)).toFixed(1)} GB` : '--'}
                    </p>
                  </div>
                  <span style={{ fontSize: '18px', fontWeight: 800 }}>
                    {perfData ? `${Math.round((perfData.usedMem / perfData.totalMem) * 100)}%` : '--'}
                  </span>
                </div>
                
                {/* memory bar indicator */}
                <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      height: '100%', 
                      background: 'var(--primary)', 
                      width: perfData ? `${(perfData.usedMem / perfData.totalMem) * 100}%` : '0%',
                      borderRadius: '4px',
                      transition: 'width 0.5s ease-out'
                    }} 
                  />
                </div>
              </div>

              {/* CPU Temperature widget */}
              <div className="glass" style={{ padding: '24px', borderRadius: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div style={{ fontSize: '32px' }}>🌡️</div>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 4px 0' }}>CPU Temp</h3>
                  <span style={{ fontSize: '20px', fontWeight: 800, color: perfData?.cpuTemp && perfData.cpuTemp > 80 ? '#ef4444' : '#e2e8f0' }}>
                    {perfData?.cpuTemp ? `${perfData.cpuTemp}°C` : 'N/A'}
                  </span>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '11px', margin: '4px 0 0 0' }}>
                    Thermal zone sensor monitoring
                  </p>
                </div>
              </div>

              {/* GPU Temperature widget */}
              <div className="glass" style={{ padding: '24px', borderRadius: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div style={{ fontSize: '32px' }}>🎮</div>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 4px 0' }}>GPU Temp</h3>
                  <span style={{ fontSize: '20px', fontWeight: 800, color: perfData?.gpuTemp && perfData.gpuTemp > 75 ? '#ef4444' : '#e2e8f0' }}>
                    {perfData?.gpuTemp ? `${perfData.gpuTemp}°C` : 'N/A'}
                  </span>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '11px', margin: '4px 0 0 0' }}>
                    Graphics controller core temp
                  </p>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Settings Section */}
        {activeSection === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Settings</h2>
            
            {/* Profile Manager */}
            {config && (
              <div className="glass" style={{ padding: '24px', borderRadius: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Profiles Management</h3>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {config.profiles.map(p => (
                    <div 
                      key={p.id} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '10px', 
                        padding: '10px 14px', 
                        borderRadius: '10px', 
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)' 
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>{p.name} ({p.rows}x{p.cols})</span>
                      <button 
                        onClick={() => handleDeleteProfileById(p.id)} 
                        style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '2px' }}
                        title="Delete Profile"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={() => setIsProfileModalOpen(true)}
                  className="btn btn-secondary"
                  style={{ fontSize: '12px', padding: '8px 16px', borderRadius: '8px' }}
                >
                  <Plus size={14} /> Add New Profile
                </button>
              </div>
            )}

            {/* Server Connection */}
            {isLocal && serverState && (
              <div className="glass" style={{ padding: '24px', borderRadius: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px' }}>Host Server Connection</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>ACTIVE PAIRING CODE</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '20px', fontWeight: 800, color: 'var(--primary)' }}>{serverState.pairingCode}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>MOBILE LAN IP URL</span>
                    <code style={{ fontSize: '12px' }}>http://{serverState.lanIp}:{serverState.port}</code>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>CLOUDFLARE TUNNEL URL</span>
                    {serverState.tunnelUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code style={{ fontSize: '12px', color: '#10b981', background: 'rgba(16, 185, 129, 0.05)', padding: '2px 6px', borderRadius: '4px', wordBreak: 'break-all' }}>
                          {serverState.tunnelUrl}
                        </code>
                        <button 
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(serverState.tunnelUrl!);
                              showToast('Tunnel URL copied!', 'success');
                            } catch {}
                          }}
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '11px'
                          }}
                          title="Copy Link"
                        >
                          Copy
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        Connecting / Starting...
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '8px 14px' }} onClick={handleExportConfig}>
                    <Download size={14} /> Export Config
                  </button>
                  <label className="btn btn-secondary" style={{ fontSize: '12px', padding: '8px 14px', cursor: 'pointer' }}>
                    <Upload size={14} /> Import Config
                    <input 
                      type="file" 
                      accept=".json" 
                      onChange={handleImportConfig} 
                      style={{ display: 'none' }} 
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Connection status drawer at bottom (PC/Electron run-mode view only) */}
        {isLocal && serverState && activeSection !== 'settings' && (
          <footer 
            className={`glass host-footer-drawer ${isFooterOpen ? 'open' : ''}`} 
            style={{ 
              marginTop: 'auto', 
              border: '1px solid rgba(255, 255, 255, 0.05)',
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
                padding: '12px 20px', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                cursor: 'pointer',
                userSelect: 'none',
                borderBottom: isFooterOpen ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
                transition: 'border-bottom var(--transition-fast)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Smartphone size={16} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Host Server Status</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {serverState.connectedClients} Client{serverState.connectedClients !== 1 ? 's' : ''} Connected
                </span>
                <span style={{ transition: 'transform 0.3s', transform: isFooterOpen ? 'rotate(180deg)' : 'none', fontSize: '10px' }}>▼</span>
              </div>
            </div>

            {/* Drawer Content */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>PAIRING CODE</span>
                  <span 
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(serverState.pairingCode);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      } catch {}
                    }}
                    style={{ 
                      fontFamily: 'monospace',
                      fontSize: '18px',
                      fontWeight: 800,
                      color: 'var(--primary)',
                      cursor: 'pointer',
                      letterSpacing: '1px'
                    }}
                  >
                    {serverState.pairingCode}
                  </span>
                  {copiedCode && <span style={{ fontSize: '11px', color: 'var(--success)', marginLeft: '8px' }}>Copied ✓</span>}
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>LAN IP</span>
                  <code style={{ fontSize: '12px' }}>http://{serverState.lanIp}:{serverState.port}</code>
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>CLOUDFLARE TUNNEL URL</span>
                  {serverState.tunnelUrl ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <code style={{ fontSize: '12px', color: '#10b981', background: 'rgba(16, 185, 129, 0.05)', padding: '2px 6px', borderRadius: '4px', wordBreak: 'break-all' }}>
                        {serverState.tunnelUrl}
                      </code>
                      <button 
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(serverState.tunnelUrl!);
                            showToast('Tunnel URL copied!', 'success');
                          } catch {}
                        }}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px'
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      Starting...
                    </span>
                  )}
                </div>
              </div>
            </div>
          </footer>
        )}

      </div>

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
