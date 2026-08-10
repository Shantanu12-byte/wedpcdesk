import React, { useState } from 'react';
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
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isSlotHovered, setIsSlotHovered] = useState(false);

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
        onMouseEnter={() => setIsSlotHovered(true)}
        onMouseLeave={() => setIsSlotHovered(false)}
        style={{
          aspectRatio: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: isSlotHovered && isEditMode ? '2px dashed var(--primary)' : '2px dashed var(--border-color)',
          borderRadius: '16px',
          cursor: isEditMode ? 'pointer' : 'default',
          color: isSlotHovered && isEditMode ? 'var(--primary)' : 'var(--text-muted)',
          backgroundColor: isSlotHovered && isEditMode ? 'rgba(99, 102, 241, 0.04)' : 'rgba(0, 0, 0, 0.15)',
          transition: 'all var(--transition-fast)',
          transform: isSlotHovered && isEditMode ? 'scale(1.02)' : 'none',
        }}
      >
        {isEditMode && <Plus size={24} style={{ opacity: isSlotHovered ? 0.8 : 0.4, transition: 'opacity 0.2s' }} />}
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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onTouchStart={() => setIsPressed(true)}
      onTouchEnd={() => setIsPressed(false)}
      style={{
        aspectRatio: '1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '12px',
        borderRadius: '16px',
        cursor: 'pointer',
        backgroundColor: button.color,
        border: isHovered ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: isHovered 
          ? `0 12px 28px ${button.color}50` 
          : `0 4px 14px ${button.color}25`,
        textAlign: 'center',
        userSelect: 'none',
        position: 'relative',
        transform: isPressed ? 'scale(0.95)' : isHovered ? 'scale(1.03)' : 'scale(1)',
        filter: isPressed ? 'brightness(0.85)' : 'none',
        transition: 'transform 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease, border-color 0.2s ease, filter 0.1s ease',
      }}
    >
      {button.icon && (button.icon.startsWith('http') || button.icon.startsWith('/') || button.icon.startsWith('data:image')) ? (
        <img 
          src={button.icon} 
          alt={button.label} 
          style={{ width: '42px', height: '42px', objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))', transform: isHovered ? 'scale(1.05)' : 'none', transition: 'transform 0.2s ease' }} 
        />
      ) : (
        <span style={{ fontSize: '32px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))', transform: isHovered ? 'scale(1.05)' : 'none', transition: 'transform 0.2s ease', display: 'inline-block' }}>
          {button.icon}
        </span>
      )}
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          color: textColor,
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
          opacity: 0.95,
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
