import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content glass" style={{ maxWidth: '400px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', color: 'var(--danger)' }}>
          <AlertTriangle size={32} />
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{title}</h2>
        </div>
        
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.6', marginBottom: '24px' }}>
          {message}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            Yes, Execute
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
