import { useCallback, useState } from 'react';
import type { HardwareStats } from '../../preload.d';
import { EMPTY_MEMORY, type MemoryStats } from './MemorySlider';

const VRAM_SAFETY_BUFFER_MB = 300;
const RAM_SAFETY_BUFFER_MB = 2048;

export function useHardwareStats(
  savedAllocationsRef: React.MutableRefObject<{
    allocatedRAM?: number;
    allocatedVRAM?: number;
  }>,
) {
  const [hardware, setHardware] = useState<HardwareStats | null>(null);
  const [ramLoading, setRamLoading] = useState(true);
  const [gpuLoading, setGpuLoading] = useState(true);
  const [ramStats, setRamStats] = useState<MemoryStats>(EMPTY_MEMORY);
  const [vramStats, setVramStats] = useState<MemoryStats>(EMPTY_MEMORY);

  const fetchHardware = useCallback(async () => {
    setRamLoading(true);
    setGpuLoading(true);
    try {
      const hw = await window.electronAPI.getVramStats();
      if (!hw) return;
      setHardware(hw);
      if (hw.ram && hw.ram.total > 0) {
        const savedRam = savedAllocationsRef.current.allocatedRAM;
        const adjustedMaxRam = Math.max(
          0,
          hw.ram.total - hw.ram.otherUsed - RAM_SAFETY_BUFFER_MB,
        );
        setRamStats((prev) => ({
          total: hw.ram.total,
          appAllocated:
            prev.appAllocated > 0
              ? prev.appAllocated
              : savedRam || Math.floor(hw.ram.total / 2),
          otherUsed: hw.ram.otherUsed,
          maxRecommended: adjustedMaxRam,
        }));
      } else {
        setRamStats(EMPTY_MEMORY);
      }
      if (hw.vram && hw.vram.total > 0) {
        const savedVram = savedAllocationsRef.current.allocatedVRAM;
        const { vram } = hw;
        const adjustedMaxVram = Math.max(
          0,
          vram.total - vram.otherUsed - VRAM_SAFETY_BUFFER_MB,
        );
        setVramStats((prev) => ({
          total: vram.total,
          appAllocated:
            prev.appAllocated > 0
              ? prev.appAllocated
              : savedVram || vram.maxRecommended,
          otherUsed: vram.otherUsed,
          maxRecommended: adjustedMaxVram,
        }));
      } else {
        setVramStats(EMPTY_MEMORY);
      }
    } catch {
      // Silently fail
    } finally {
      setRamLoading(false);
      setGpuLoading(false);
    }
  }, [savedAllocationsRef]);

  const isUnifiedMemory = hardware ? hardware.isUnifiedMemory : false;
  const showVramSection =
    !gpuLoading && !isUnifiedMemory && vramStats.total > 0;
  const ramTitle = isUnifiedMemory ? 'Unified Memory' : 'System Memory (RAM)';
  const vramTitle =
    hardware && hardware.selectedGpu
      ? `Video Memory (GPU) — ${hardware.selectedGpu.model}`
      : 'Video Memory (GPU)';

  return {
    hardware,
    ramLoading,
    gpuLoading,
    ramStats,
    vramStats,
    setRamStats,
    setVramStats,
    isUnifiedMemory,
    showVramSection,
    ramTitle,
    vramTitle,
    fetchHardware,
  };
}
