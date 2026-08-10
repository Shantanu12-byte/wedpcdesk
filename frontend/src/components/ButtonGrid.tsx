import React, { useState, useEffect } from 'react';
import { Profile, ButtonConfig } from '../../../shared/types';
import ButtonCard from './ButtonCard';

interface ButtonGridProps {
  profile: Profile;
  isEditMode: boolean;
  onExecute: (btn: ButtonConfig) => void;
  onConfigureButton: (coordinate: string, btn: ButtonConfig | null) => void;
  onUpdateButtons: (buttons: Record<string, ButtonConfig>) => void;
}

const ButtonGrid: React.FC<ButtonGridProps> = ({
  profile,
  isEditMode,
  onExecute,
  onConfigureButton,
  onUpdateButtons,
}) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);
  const [draggedCoord, setDraggedCoord] = useState<string | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleDragStart = (e: React.DragEvent, coordinate: string) => {
    setDraggedCoord(coordinate);
    e.dataTransfer.setData('text/plain', coordinate);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetCoord: string) => {
    e.preventDefault();
    const sourceCoord = e.dataTransfer.getData('text/plain') || draggedCoord;
    if (!sourceCoord || sourceCoord === targetCoord) return;

    const newButtons = { ...profile.buttons };
    const sourceBtn = newButtons[sourceCoord];
    const targetBtn = newButtons[targetCoord];

    // Swap the buttons in config
    if (sourceBtn) {
      newButtons[targetCoord] = sourceBtn;
    } else {
      delete newButtons[targetCoord];
    }

    if (targetBtn) {
      newButtons[sourceCoord] = targetBtn;
    } else {
      delete newButtons[sourceCoord];
    }

    onUpdateButtons(newButtons);
    setDraggedCoord(null);
  };

  const { rows, cols, buttons } = profile;

  // On Mobile, in Run Mode, we render a fluid grid containing only configured buttons so there are no empty spacer gaps.
  const renderFluidGrid = isMobile && !isEditMode;

  if (renderFluidGrid) {
    // Extract configured buttons and sort them by position (row, then col)
    const activeButtons = Object.entries(buttons)
      .map(([coord, btn]) => {
        const [r, c] = coord.split(',').map(Number);
        return { coord, btn, r, c };
      })
      .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.c - b.c));

    return (
      <div 
        className="deck-grid" 
        style={{ 
          gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
          gap: '12px',
          padding: '4px'
        }}
      >
        {activeButtons.map(({ coord, btn }) => (
          <ButtonCard
            key={coord}
            button={btn}
            coordinate={coord}
            isEditMode={isEditMode}
            onExecute={onExecute}
            onConfigure={onConfigureButton}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))}
        {activeButtons.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No buttons configured. Turn on Edit Mode to add buttons.
          </div>
        )}
      </div>
    );
  }

  // Default coordinate-based strict grid (Desktop / Edit mode)
  const gridCells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const coord = `${r},${c}`;
      const btn = buttons[coord] || null;
      gridCells.push(
        <ButtonCard
          key={coord}
          button={btn}
          coordinate={coord}
          isEditMode={isEditMode}
          onExecute={onExecute}
          onConfigure={onConfigureButton}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      );
    }
  }

  return (
    <div 
      className="deck-grid" 
      style={{ 
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        '--grid-cols': cols
      } as React.CSSProperties}
    >
      {gridCells}
    </div>
  );
};

export default ButtonGrid;
