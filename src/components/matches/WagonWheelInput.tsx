"use client";

import { useState, useRef } from "react";
import styles from "./WagonWheelInput.module.css";

type Props = {
  onConfirm: (x: number, y: number) => void;
  onCancel: () => void;
};

export default function WagonWheelInput({ onConfirm, onCancel }: Props) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!fieldRef.current) return;
    const rect = fieldRef.current.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    // Constrain to circle (optional, but good for UI)
    // Center is 50, 50. Warning: simple box constraint here for now.
    setCoords({ x, y });
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.title}>Tap where the ball went</div>
        <div 
            className={styles.fieldContainer} 
            ref={fieldRef}
            onClick={handleClick}
            onTouchStart={handleClick} // Basic touch support
        >
          <div className={styles.innerCircle} />
          <div className={styles.pitch} />
          
          {/* Marker */}
          {coords ? (
            <div 
                style={{
                    position: 'absolute',
                    top: `${coords.y}%`,
                    left: `${coords.x}%`,
                    width: '12px',
                    height: '12px',
                    background: '#fff',
                    borderRadius: '50%',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
                    pointerEvents: 'none'
                }}
            />
          ) : null}
        </div>
        
        <div className={styles.actions}>
            <button className={styles.actionButton} onClick={onCancel}>Skip</button>
            <button 
                className={`${styles.actionButton} ${styles.confirmButton}`} 
                disabled={!coords}
                onClick={() => coords && onConfirm(coords.x, coords.y)}
            >
                Confirm
            </button>
        </div>
      </div>
    </div>
  );
}
