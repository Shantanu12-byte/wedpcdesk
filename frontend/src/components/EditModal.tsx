import React, { useState, useEffect } from 'react';
import { ButtonConfig, ActionType, ActionConfig } from '../../../shared/types';
import { X, Trash2, Eye } from 'lucide-react';

interface EditModalProps {
  isOpen: boolean;
  button: ButtonConfig | null;
  onSave: (button: ButtonConfig) => void;
  onDelete: () => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#4f46e5', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', 
  '#ef4444', '#ec4899', '#8b5cf6', '#111827', '#374151'
];

const PRESET_EMOJIS = [
  '🔊', '🔉', '🔇', '🖥️', '🔒', '📝', '⏯️', '⏮️', '⏭️', 
  '🎮', '🌐', '📁', '⚙️', '🎵', '🔋', '🚀', '🔥', '💡'
];

const PRESET_APPS = [
  {
    name: 'Firefox',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48Y2lyY2xlIGN4PSIyNTYiIGN5PSIyNTYiIHI9IjI1NiIgZmlsbD0iI2ZmNzEwMCIvPjxjaXJjbGUgY3g9IjI1NiIgY3k9IjI1NiIgcj0iMjAwIiBmaWxsPSIjMDAzOGE4Ii8+PHBhdGggZmlsbD0iI2ZmZDEwMCIgZD0iTTI1NiAxMDBjLTg2IDAtMTU2IDcwLTE1NiAxNTYgMCA4NiA3MCAxNTYgMTU2IDE1NiA0MCAwIDc2LTE1IDEwNC00MC0zMC01LTUwLTMwLTUwLTYwIDAtMzUgMjUtNjUgNjAtNzAtMTUtNTAtNDUtODAtODYtODYgMCAwLTEwLTMwLTI4LTU2eiIvPjwvc3ZnPg==',
    color: '#ff7100',
    path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  },
  {
    name: 'Spotify',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBmaWxsPSIjRkZGIj48Y2lyY2xlIGN4PSIyNTYiIGN5PSIyNTYiIHI9IjI1NiIgZmlsbD0iIzFEQjg1NCIvPjxwYXRoIGQ9Ik0zODIgMzU1Yy02IDgtMTYgMTAtMjQgNS01My0zMi0xMTktMzktMTk4LTIxLTkgMy0xOS00LTIxLTEzczMtMTkgMTMtMjFjODctMjAgMTYxLTEyIDIyMSAyNCA5IDUgMTEgMTYgNiAyNHptMzEtNjZjLTggMTItMjQgMTYtMzYgOC02MS0zOC0xNTQtNDktMjI2LTI3LTE0IDQtMjktNC0zMy0xNy00LTE0IDQtMjkgMTctMzMgODItMjUgMTg1LTEyIDI1NCAzMCAxMiA4IDE2IDI0IDggMzZ6bTMtNzBjLTczLTQ0LTE5NS00OC0yNjYtMjYtMTEgMy0yMy0zLTI2LTE1LTMtMTEgMy0yMyAxNS0yNiA4Mi0yNSAyMTctMjAgMzAxIDMwIDEwIDYgMTMgMjAgNyAzMC02IDExLTIwIDE0LTMxIDd6Ii8+PC9zdmc=',
    color: '#1db954',
    path: 'C:\\Users\\shant\\AppData\\Roaming\\Spotify\\Spotify.exe',
  },
  {
    name: 'Valorant',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBmaWxsPSIjRkY0NjU1Ij48cmVjdCB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgcng9IjEyOCIgZmlsbD0iIzExMTgyNyIvPjxwYXRoIGQ9Ik0yNTYgOTBsLTE0MCAyMTBoNzBsNzAtMTA1IDcwIDEwNWg3MHpNMTg2IDMzMGw3MCAxMDUgNzAtMTA1eiIvPjwvc3ZnPg==',
    color: '#111827',
    path: 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe --launch-product=valorant --launch-patchline=live',
  }
];

const EditModal: React.FC<EditModalProps> = ({
  isOpen,
  button,
  onSave,
  onDelete,
  onClose,
}) => {
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('🔘');
  const [color, setColor] = useState('#4f46e5');
  const [confirmBeforeRun, setConfirmBeforeRun] = useState(false);
  
  // Action state
  const [actionType, setActionType] = useState<ActionType>('launch');
  const [launchPath, setLaunchPath] = useState('');
  const [shortcutKeys, setShortcutKeys] = useState('');
  const [volumeType, setVolumeType] = useState<'up' | 'down' | 'mute'>('up');
  const [powerType, setPowerType] = useState<'lock' | 'sleep' | 'minimize_all' | 'shutdown' | 'restart'>('lock');
  const [commandStr, setCommandStr] = useState('');

  useEffect(() => {
    if (button) {
      setLabel(button.label);
      setIcon(button.icon);
      setColor(button.color);
      setConfirmBeforeRun(button.confirmBeforeRun);
      
      const act = button.action;
      setActionType(act.type);
      setLaunchPath(act.launchPath || '');
      setShortcutKeys(act.shortcutKeys || '');
      setVolumeType(act.volumeType || 'up');
      setPowerType(act.powerType || 'lock');
      setCommandStr(act.commandStr || '');
    } else {
      // Defaults for a new button
      setLabel('');
      setIcon('🔘');
      setColor('#4f46e5');
      setConfirmBeforeRun(false);
      setActionType('launch');
      setLaunchPath('');
      setShortcutKeys('');
      setVolumeType('up');
      setPowerType('lock');
      setCommandStr('');
    }
  }, [button, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    const action: ActionConfig = {
      type: actionType,
      ...(actionType === 'launch' && { launchPath }),
      ...(actionType === 'shortcut' && { shortcutKeys }),
      ...(actionType === 'volume' && { volumeType }),
      ...(actionType === 'power' && { powerType }),
      ...(actionType === 'command' && { commandStr }),
    };

    onSave({
      id: button?.id || `btn_${Date.now()}`,
      label,
      icon,
      color,
      action,
      confirmBeforeRun,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content glass" style={{ width: '90%', maxWidth: '550px' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>
            {button ? 'Configure Button' : 'Add Button'}
          </h2>
          <button 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Live Preview & Design Section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '20px', marginBottom: '24px', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Label</label>
              <input 
                type="text" 
                value={label} 
                onChange={(e) => setLabel(e.target.value)} 
                placeholder="Button Label" 
              />
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Icon Emoji</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  value={icon} 
                  onChange={(e) => setIcon(e.target.value)} 
                  maxLength={10} 
                  style={{ width: '80px', textAlign: 'center', fontSize: '18px' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignContent: 'center' }}>
                  {PRESET_EMOJIS.map(emoji => (
                    <button 
                      key={emoji} 
                      onClick={() => setIcon(emoji)}
                      style={{ background: 'rgba(255,255,255,0.05)', border: 'none', padding: '4px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Button Live Preview */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Eye size={12} /> Preview
            </span>
            <div 
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '12px',
                backgroundColor: color,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '6px',
                textAlign: 'center',
                boxShadow: `0 8px 20px ${color}33`,
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            >
              {icon && (icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('data:image')) ? (
                <img 
                  src={icon} 
                  alt={label} 
                  style={{ width: '28px', height: '28px', objectFit: 'contain' }} 
                />
              ) : (
                <span style={{ fontSize: '28px' }}>{icon}</span>
              )}
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                {label || 'Label'}
              </span>
            </div>
          </div>
        </div>

        {/* Color picker & Presets */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Color</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input 
              type="color" 
              value={color} 
              onChange={(e) => setColor(e.target.value)} 
              style={{ width: '42px', height: '40px', padding: '0', border: 'none', cursor: 'pointer', borderRadius: '8px', overflow: 'hidden' }}
            />
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: c,
                  border: color === c ? '2px solid white' : '1px solid rgba(255,255,255,0.15)',
                  cursor: 'pointer',
                  padding: '0'
                }}
              />
            ))}
          </div>
        </div>

        {/* Action Configuration */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>Action Settings</h3>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Quick App Presets</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {PRESET_APPS.map(app => (
                <button
                  key={app.name}
                  type="button"
                  onClick={() => {
                    setLabel(app.name);
                    setIcon(app.icon);
                    setColor(app.color);
                    setActionType('launch');
                    setLaunchPath(app.path);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  <img src={app.icon} alt={app.name} style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
                  {app.name}
                </button>
              ))}
            </div>
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Action Type</label>
            <select value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)}>
              <option value="launch">Launch Application</option>
              <option value="shortcut">Keyboard Shortcut Simulation</option>
              <option value="volume">Volume Control</option>
              <option value="power">System / Power action</option>
              <option value="command">Custom Shell Command (Advanced)</option>
            </select>
          </div>

          {/* Action Context Inputs */}
          {actionType === 'launch' && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Executable / App Path or URL</label>
              <input 
                type="text" 
                value={launchPath} 
                onChange={(e) => setLaunchPath(e.target.value)} 
                placeholder="e.g. notepad.exe or chrome.exe or https://google.com" 
              />
            </div>
          )}

          {actionType === 'shortcut' && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Key Combination</label>
              <input 
                type="text" 
                value={shortcutKeys} 
                onChange={(e) => setShortcutKeys(e.target.value)} 
                placeholder="e.g. Ctrl+Shift+Esc or MediaPlayPause" 
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                Supported: Ctrl, Shift, Alt modifiers split by +. E.g., Ctrl+Shift+T. Or keys like MediaPlayPause, Esc, Enter.
              </span>
            </div>
          )}

          {actionType === 'volume' && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Volume Change</label>
              <select value={volumeType} onChange={(e) => setVolumeType(e.target.value as any)}>
                <option value="up">Volume Up</option>
                <option value="down">Volume Down</option>
                <option value="mute">Mute / Unmute Toggle</option>
              </select>
            </div>
          )}

          {actionType === 'power' && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>System Command</label>
              <select value={powerType} onChange={(e) => setPowerType(e.target.value as any)}>
                <option value="lock">Lock Computer</option>
                <option value="sleep">Put to Sleep</option>
                <option value="minimize_all">Minimize All Windows (Show Desktop)</option>
                <option value="shutdown">Shutdown Machine</option>
                <option value="restart">Restart Machine</option>
              </select>
            </div>
          )}

          {actionType === 'command' && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Shell Command (runs in cmd/powershell)</label>
              <textarea 
                value={commandStr} 
                onChange={(e) => setCommandStr(e.target.value)} 
                placeholder="e.g. ipconfig or echo hello"
                rows={3}
                style={{ resize: 'vertical' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '4px', display: 'block' }}>
                ⚠️ Warning: Raw commands will run with user privileges. Use caution!
              </span>
            </div>
          )}
        </div>

        {/* Extra Confirmation Option */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <input 
            type="checkbox" 
            id="confirmBeforeRun" 
            checked={confirmBeforeRun} 
            onChange={(e) => setConfirmBeforeRun(e.target.checked)}
            style={{ width: 'auto', cursor: 'pointer' }}
          />
          <label htmlFor="confirmBeforeRun" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none' }}>
            Require confirmation popup before executing this button
          </label>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {button && (
              <button className="btn btn-danger" onClick={onDelete} style={{ gap: '6px' }}>
                <Trash2 size={16} /> Delete
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              Save Changes
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default EditModal;
