import React from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  mode: 'listening' | 'speaking' | 'idle';
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, mode }) => {
  const bars = [1, 2, 3, 4, 5];
  
  const getColor = () => {
    if (mode === 'speaking') return 'bg-teal-500'; // AI Speaking
    if (mode === 'listening') return 'bg-rose-500'; // User Speaking
    return 'bg-slate-300';
  };

  return (
    <div className="flex items-end justify-center gap-1.5 h-12">
      {bars.map((i) => (
        <div
          key={i}
          className={`w-2 rounded-full transition-all duration-300 ${getColor()} ${isActive ? 'animate-pulse' : ''}`}
          style={{
            height: isActive ? `${Math.random() * 100}%` : '20%',
            animationDuration: `${0.4 + i * 0.1}s`
          }}
        />
      ))}
    </div>
  );
};
