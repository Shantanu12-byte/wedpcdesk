import React from 'react';
import { ButtonConfig } from '../../../shared/types';
import { Plus } from 'lucide-react';

interface ButtonCardProps {
  button: ButtonConfig | null;
  coordinate: string; // "row,col"
  isEditMode: boolean;
  onExecute: (btn: ButtonConfig) => void;
  onConfigure: (coordinate: string, btn: ButtonConfig | null) => void;
  onDragStart: (e: React.DragEvent, coordinate: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetCoordinate: string) => void;
}

const ButtonCard: React.FC<ButtonCardProps> = ({
  button,
  coordinate,
  isEditMode,
  onExecute,
  onConfigure,
  onDragStart,
  onDragOver,
  onDrop,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log(`ButtonCard clicked: coord=${coordinate}, label=${button?.label}, isEditMode=${isEditMode}`);
    if (isEditMode) {
      onConfigure(coordinate, button);
    } else if (button) {
      onExecute(button);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!isEditMode || !button) {
      e.preventDefault();
      return;
    }
    onDragStart(e, coordinate);
  };

  const handleDragOverLocal = (e: React.DragEvent) => {
    if (!isEditMode) return;
    onDragOver(e);
  };

  const handleDropLocal = (e: React.DragEvent) => {
    if (!isEditMode) return;
    onDrop(e, coordinate);
  };

  if (!button) {
    return (
      <div
        onClick={handleClick}
        onDragOver={handleDragOverLocal}
        onDrop={handleDropLocal}
        className="glass-interactive"
        style={{
          aspectRatio: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed var(--border-color)',
          borderRadius: '16px',
          cursor: isEditMode ? 'pointer' : 'default',
          color: 'var(--text-muted)',
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
        }}
      >
        {isEditMode && <Plus size={24} style={{ opacity: 0.5 }} />}
      </div>
    );
  }

  // Calculate high-contrast text color based on background color or default to white
  const textColor = '#ffffff';

  return (
    <div
      draggable={isEditMode}
      onDragStart={handleDragStart}
      onDragOver={handleDragOverLocal}
      onDrop={handleDropLocal}
      onClick={handleClick}
      className="glass-interactive"
      style={{
        aspectRatio: '1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '12px',
        borderRadius: '16px',
        cursor: 'pointer',
        backgroundColor: button.color,
        border: '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: `0 4px 14px ${button.color}25`,
        textAlign: 'center',
        userSelect: 'none',
        position: 'relative',
        transform: 'translateZ(0)',
        transition: 'transform 0.1s ease, box-shadow 0.2s ease, filter 0.2s ease',
      }}
      onMouseDown={(e) => {
        if (!isEditMode) {
          e.currentTarget.style.transform = 'scale(0.96)';
          e.currentTarget.style.filter = 'brightness(0.9)';
        }
      }}
      onMouseUp={(e) => {
        if (!isEditMode) {
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.filter = 'none';
        }
      }}
      onMouseLeave={(e) => {
        if (!isEditMode) {
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.filter = 'none';
        }
      }}
    >
      {button.icon && (button.icon.startsWith('http') || button.icon.startsWith('/') || button.icon.startsWith('data:image')) ? (
        <img 
          src={button.icon} 
          alt={button.label} 
          style={{ width: '40px', height: '40px', objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }} 
        />
      ) : (
        <span style={{ fontSize: '32px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}>
          {button.icon}
        </span>
      )}
      <span
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: textColor,
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textShadow: '0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        {button.label}
      </span>

      {isEditMode && (
        <div
          style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: '#fff',
            opacity: 0.6,
          }}
        />
      )}
    </div>
  );
};

export default ButtonCard;
