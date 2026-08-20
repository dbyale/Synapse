/* eslint-disable import/prefer-default-export */
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import util from 'util';
import { exec } from 'child_process';
import si from 'systeminformation';
import { getModelsDirectory, loadSettings } from './settings';
import type {
  BackendDownload,
  BackendInfo,
  BackendTag,
} from '../renderer/preload.d';

const execAsync = util.promisify(exec);

function getBinaryVersions(): { llama: string } {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
    );
    return packageJson.binaryVersions || { llama: 'b10375' };
  } catch {
    return { llama: 'b10375' };
  }
}

const LLAMA_VERSION = getBinaryVersions().llama;
const LLAMA_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}`;

function llamaUrl(target: string, ext: 'zip' | 'tar.gz'): string {
  return `${LLAMA_BASE}/llama-${LLAMA_VERSION}-bin-${target}.${ext}`;
}

// Mirrors .erb/scripts/setup-binaries.ts target naming so downloaded folders
// match the folders the runtime expects under assets/bin.
function buildDownload(
  id: string,
  label: string,
  icon: BackendDownload['icon'],
  target: string,
  ext: 'zip' | 'tar.gz',
  extra: Partial<BackendDownload> = {},
): BackendDownload {
  return {
    id,
    label,
    icon,
    url: llamaUrl(target, ext),
    folder: target,
    files: [`llama-${LLAMA_VERSION}-bin-${target}.${ext}`],
    recommended: false,
    ...extra,
  };
}

async function getNvidiaDriverMajor(): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
      { timeout: 5000 },
    );
    const v = stdout.trim().split('\n')[0]?.trim();
    if (v) {
      const major = parseInt(v.split('.')[0], 10);
      if (!Number.isNaN(major)) return major;
    }
  } catch {
    // nvidia-smi not available on this system
  }

  try {
    const gpu = await si.graphics();
    const ctrl = gpu.controllers.find(
      (c) => c.vendor.toLowerCase().includes('nvidia') && c.driverVersion,
    );
    if (ctrl?.driverVersion) {
      const parts = ctrl.driverVersion.split('.');
      if (parts.length === 4) {
        const last = parseInt(parts[3], 10);
        if (!Number.isNaN(last)) return Math.floor(last / 100);
      } else {
        const major = parseInt(parts[0], 10);
        if (!Number.isNaN(major)) return major;
      }
    }
  } catch {
    // systeminformation failed to enumerate controllers
  }

  return null;
}

async function getLinuxDistro(): Promise<string | null> {
  try {
    const raw = fs.readFileSync('/etc/os-release', 'utf8');
    const match = raw.match(/^ID=["']?([^"'\n]+)["']?/m);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    // Not a Linux system
    return null;
  }
}

function hasNvidia(
  gpus: si.Systeminformation.GraphicsControllerData[],
): boolean {
  return gpus.some((g) => g.vendor.toLowerCase().includes('nvidia'));
}

function hasAmd(gpus: si.Systeminformation.GraphicsControllerData[]): boolean {
  return gpus.some((g) => {
    const vendor = g.vendor.toLowerCase();
    return (
      vendor.includes('amd') ||
      vendor.includes('radeon') ||
      /\bati\b/.test(vendor)
    );
  });
}

function hasIntelGpu(
  gpus: si.Systeminformation.GraphicsControllerData[],
): boolean {
  return gpus.some((g) => g.vendor.toLowerCase().includes('intel'));
}

function hasQualcomm(
  gpus: si.Systeminformation.GraphicsControllerData[],
): boolean {
  return gpus.some(
    (g) =>
      g.vendor.toLowerCase().includes('qualcomm') ||
      g.model.toLowerCase().includes('adreno'),
  );
}

function hasIntelNpuControllers(
  gpus: si.Systeminformation.GraphicsControllerData[],
): boolean {
  return gpus.some((g) => {
    const model = g.model.toLowerCase();
    return (
      model.includes('npu') ||
      model.includes('movidius') ||
      model.includes('ai boost')
    );
  });
}

// Windows PCI device IDs for known Intel NPUs:
//   7D1D — Meteor Lake, 643E — Arrow Lake, 7E46 — Lunar Lake, 7771 — Panther Lake
const INTEL_NPU_DEVICE_IDS = ['7D1D', '643E', '7E46', '7771'];

let npuDetectionCache: boolean | null = null;

async function detectIntelNpuUncached(
  gpus: si.Systeminformation.GraphicsControllerData[],
): Promise<boolean> {
  if (process.platform === 'darwin') return false;

  // 1. Some systems report the NPU as a graphics controller
  if (hasIntelNpuControllers(gpus)) return true;

  // 2. Windows: scan PCI enumeration for known Intel NPU device IDs,
  //    then fall back to the "Neural processors" PnP device class.
  if (process.platform === 'win32') {
    const deviceFound = await Promise.all(
      INTEL_NPU_DEVICE_IDS.map(async (deviceId) => {
        try {
          await execAsync(
            `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\PCI" /f "VEN_8086&DEV_${deviceId}" /k`,
            { timeout: 4000 },
          );
          return true;
        } catch {
          // Device ID not present in the enumeration
          return false;
        }
      }),
    );
    if (deviceFound.some(Boolean)) return true;

    try {
      const { stdout } = await execAsync(
        "powershell -NoProfile -Command \"Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'NeuralProcessors' -or $_.FriendlyName -match 'npu|ai boost|movidius' } | Measure-Object | Select-Object -ExpandProperty Count\"",
        { timeout: 6000 },
      );
      const count = parseInt(stdout.trim(), 10);
      if (!Number.isNaN(count) && count > 0) return true;
    } catch {
      // PowerShell unavailable — treat as not detected
    }
  }

  // 3. Linux: the Intel NPU driver exposes /dev/accel devices
  if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/sys/class/accel')) {
        const entries = fs.readdirSync('/sys/class/accel');
        if (entries.length > 0) return true;
      }
      if (fs.existsSync('/sys/bus/pci/drivers/intel_vpu')) return true;
    } catch {
      // sysfs unavailable — treat as not detected
    }
  }

  return false;
}

async function detectIntelNpu(
  gpus: si.Systeminformation.GraphicsControllerData[],
): Promise<boolean> {
  if (npuDetectionCache !== null) return npuDetectionCache;
  npuDetectionCache = await detectIntelNpuUncached(gpus);
  return npuDetectionCache;
}

function hasDiscreteGpu(
  gpus: si.Systeminformation.GraphicsControllerData[],
): boolean {
  return gpus.some((g) => !g.vramDynamic && (g.vram ?? 0) > 0);
}

// Every prebuilt binary exposed by the llama.cpp release, mirroring
// .erb/scripts/setup-binaries.ts and the rest of the release assets.
// `runtime` is the target's hardware class: x64, arm64, or metal (macOS).
// Targets whose runtime never matches a desktop system (s390x, android)
// are always flagged "Wrong Architecture".
interface OtherTarget {
  id: string;
  label: string;
  icon: BackendDownload['icon'];
  target: string;
  ext: 'zip' | 'tar.gz';
  runtime: 'x64' | 'arm64' | 'metal' | 's390x' | 'android';
  requires?: 'nvidia' | 'amd' | 'intel-gpu' | 'qualcomm' | 'intel-npu';
  cudart?: boolean;
}

const OTHER_TARGETS: OtherTarget[] = [
  // Windows
  {
    id: 'win-cpu-x64',
    label: 'CPU (x64)',
    icon: 'cpu',
    target: 'win-cpu-x64',
    ext: 'zip',
    runtime: 'x64',
  },
  {
    id: 'win-cpu-arm64',
    label: 'CPU (arm64)',
    icon: 'cpu',
    target: 'win-cpu-arm64',
    ext: 'zip',
    runtime: 'arm64',
  },
  {
    id: 'win-vulkan-x64',
    label: 'Vulkan (x64)',
    icon: 'vulkan',
    target: 'win-vulkan-x64',
    ext: 'zip',
    runtime: 'x64',
  },
  {
    id: 'win-cuda-12.4-x64',
    label: 'CUDA 12.4 (x64)',
    icon: 'cuda',
    target: 'win-cuda-12.4-x64',
    ext: 'zip',
    runtime: 'x64',
    requires: 'nvidia',
    cudart: true,
  },
  {
    id: 'win-cuda-13.3-x64',
    label: 'CUDA 13.3 (x64)',
    icon: 'cuda',
    target: 'win-cuda-13.3-x64',
    ext: 'zip',
    runtime: 'x64',
    requires: 'nvidia',
    cudart: true,
  },
  {
    id: 'win-cuda-13.4-arm64',
    label: 'CUDA 13.4 (arm64, preview)',
    icon: 'cuda',
    target: 'win-cuda-13.4-arm64',
    ext: 'zip',
    runtime: 'arm64',
    requires: 'nvidia',
    cudart: true,
  },
  {
    id: 'win-opencl-adreno-arm64',
    label: 'OpenCL Adreno (arm64)',
    icon: 'opencl',
    target: 'win-opencl-adreno-arm64',
    ext: 'zip',
    runtime: 'arm64',
    requires: 'qualcomm',
  },
  {
    id: 'win-openvino-2026.2.1-x64',
    label: 'OpenVINO (x64)',
    icon: 'openvino',
    target: 'win-openvino-2026.2.1-x64',
    ext: 'zip',
    runtime: 'x64',
    requires: 'intel-npu',
  },
  {
    id: 'win-rocm-7.14-x64',
    label: 'ROCm 7.14 (x64)',
    icon: 'rocm',
    target: 'win-rocm-7.14-x64',
    ext: 'zip',
    runtime: 'x64',
    requires: 'amd',
  },
  {
    id: 'win-sycl-x64',
    label: 'SYCL (x64)',
    icon: 'sycl',
    target: 'win-sycl-x64',
    ext: 'zip',
    runtime: 'x64',
    requires: 'intel-gpu',
  },
  // Linux
  {
    id: 'ubuntu-x64',
    label: 'CPU (x64)',
    icon: 'cpu',
    target: 'ubuntu-x64',
    ext: 'tar.gz',
    runtime: 'x64',
  },
  {
    id: 'ubuntu-arm64',
    label: 'CPU (arm64)',
    icon: 'cpu',
    target: 'ubuntu-arm64',
    ext: 'tar.gz',
    runtime: 'arm64',
  },
  {
    id: 'ubuntu-vulkan-x64',
    label: 'Vulkan (x64)',
    icon: 'vulkan',
    target: 'ubuntu-vulkan-x64',
    ext: 'tar.gz',
    runtime: 'x64',
  },
  {
    id: 'ubuntu-vulkan-arm64',
    label: 'Vulkan (arm64)',
    icon: 'vulkan',
    target: 'ubuntu-vulkan-arm64',
    ext: 'tar.gz',
    runtime: 'arm64',
  },
  {
    id: 'ubuntu-openvino-2026.2.1-x64',
    label: 'OpenVINO (x64)',
    icon: 'openvino',
    target: 'ubuntu-openvino-2026.2.1-x64',
    ext: 'tar.gz',
    runtime: 'x64',
    requires: 'intel-npu',
  },
  {
    id: 'ubuntu-rocm-7.14-x64',
    label: 'ROCm 7.14 (x64)',
    icon: 'rocm',
    target: 'ubuntu-rocm-7.14-x64',
    ext: 'tar.gz',
    runtime: 'x64',
    requires: 'amd',
  },
  {
    id: 'ubuntu-sycl-fp16-x64',
    label: 'SYCL FP16 (x64)',
    icon: 'sycl',
    target: 'ubuntu-sycl-fp16-x64',
    ext: 'tar.gz',
    runtime: 'x64',
    requires: 'intel-gpu',
  },
  {
    id: 'ubuntu-sycl-fp32-x64',
    label: 'SYCL FP32 (x64)',
    icon: 'sycl',
    target: 'ubuntu-sycl-fp32-x64',
    ext: 'tar.gz',
    runtime: 'x64',
    requires: 'intel-gpu',
  },
  {
    id: 'ubuntu-s390x',
    label: 'CPU (s390x)',
    icon: 'cpu',
    target: 'ubuntu-s390x',
    ext: 'tar.gz',
    runtime: 's390x',
  },
  // macOS
  {
    id: 'macos-arm64',
    label: 'Apple Silicon (Metal) (arm64)',
    icon: 'apple',
    target: 'macos-arm64',
    ext: 'tar.gz',
    runtime: 'metal',
  },
  {
    id: 'macos-x64',
    label: 'Intel (Metal) (x64)',
    icon: 'apple',
    target: 'macos-x64',
    ext: 'tar.gz',
    runtime: 'metal',
  },
  // Android
  {
    id: 'android-arm64',
    label: 'Android (arm64)',
    icon: 'android',
    target: 'android-arm64',
    ext: 'tar.gz',
    runtime: 'android',
  },
];

function tagOtherTarget(
  target: OtherTarget,
  context: {
    runtime: string;
    hasNvidia: boolean;
    hasAmd: boolean;
    hasIntelGpu: boolean;
    hasQualcomm: boolean;
    hasIntelNpu: boolean;
    nvidiaDriverMajor: number | null;
  },
): BackendDownload['tags'] | undefined {
  const tags: BackendTag[] = [];

  // Built for a different hardware class than this system
  if (target.runtime !== context.runtime) tags.push('wrong-arch');

  // Built for a GPU vendor this system does not have (or cannot run).
  // When a discrete NVIDIA GPU is present it is the only GPU backend offered;
  // other vendors' builds are treated as "No Valid GPU" even if their iGPU
  // happens to be present.
  if (target.requires === 'nvidia' && !context.hasNvidia) tags.push('no-gpu');
  if (target.requires === 'amd' && (!context.hasAmd || context.hasNvidia))
    tags.push('no-gpu');
  if (
    target.requires === 'intel-gpu' &&
    (!context.hasIntelGpu || context.hasNvidia)
  )
    tags.push('no-gpu');
  if (target.requires === 'qualcomm' && !context.hasQualcomm)
    tags.push('no-gpu');
  if (
    target.requires === 'intel-npu' &&
    (!context.hasIntelNpu || context.hasNvidia)
  )
    tags.push('no-gpu');

  // CUDA 12.x needs driver >= 525 but < 580; 13.x needs >= 580
  if (
    target.id === 'win-cuda-13.3-x64' &&
    context.nvidiaDriverMajor !== null &&
    context.nvidiaDriverMajor < 580
  ) {
    tags.push('outdated');
  }
  if (
    target.id === 'win-cuda-12.4-x64' &&
    context.nvidiaDriverMajor !== null &&
    context.nvidiaDriverMajor >= 580
  ) {
    tags.push('outdated');
  }

  return tags.length > 0 ? tags : undefined;
}

export async function getBackendInfo(): Promise<BackendInfo> {
  const { platform, arch } = process;

  let gpuList: si.Systeminformation.GraphicsControllerData[] = [];
  try {
    const gpu = await si.graphics();
    gpuList = gpu.controllers || [];
  } catch {
    // Hardware enumeration unavailable
  }

  let nvidiaDriverMajor: number | null = null;
  if (hasNvidia(gpuList)) {
    nvidiaDriverMajor = await getNvidiaDriverMajor();
  }

  let distro: string | null = null;
  if (platform === 'linux') {
    distro = await getLinuxDistro();
  }

  const intelNpu = await detectIntelNpu(gpuList);

  const tagContext = {
    runtime: platform === 'darwin' ? 'metal' : arch,
    hasNvidia: hasNvidia(gpuList),
    hasAmd: hasAmd(gpuList),
    hasIntelGpu: hasIntelGpu(gpuList),
    hasQualcomm: hasQualcomm(gpuList),
    hasIntelNpu: intelNpu,
    nvidiaDriverMajor,
  };

  // Same compatibility tags as "other" backends, looked up by release target.
  function tagDownload(
    download: BackendDownload,
    context: typeof tagContext,
  ): BackendDownload['tags'] | undefined {
    const target = OTHER_TARGETS.find((t) => t.target === download.folder);
    return target ? tagOtherTarget(target, context) : undefined;
  }

  const isAppleSilicon = platform === 'darwin' && arch === 'arm64';

  const warnings: string[] = [];
  const recommended: BackendDownload[] = [];
  const optional: BackendDownload[] = [];

  if (platform === 'darwin') {
    if (isAppleSilicon) {
      recommended.push(
        buildDownload(
          'macos-arm64',
          'Apple Silicon (Metal) (arm64)',
          'apple',
          'macos-arm64',
          'tar.gz',
          {
            sublabel: 'GPU + CPU',
            recommended: true,
          },
        ),
      );
    } else {
      recommended.push(
        buildDownload(
          'macos-x64',
          'Intel (Metal) (x64)',
          'apple',
          'macos-x64',
          'tar.gz',
          {
            sublabel: 'GPU + CPU',
            recommended: true,
          },
        ),
      );
    }
  } else if (platform === 'win32') {
    if (arch === 'arm64') {
      if (hasQualcomm(gpuList)) {
        recommended.push(
          buildDownload(
            'win-adreno-arm64',
            'Qualcomm Adreno (OpenCL) (arm64)',
            'opencl',
            'win-opencl-adreno-arm64',
            'zip',
            {
              recommended: true,
            },
          ),
        );
        recommended.push(
          buildDownload(
            'win-cpu-arm64',
            'CPU (arm64)',
            'cpu',
            'win-cpu-arm64',
            'zip',
            {
              sublabel: 'Fallback — no Windows arm64 Vulkan build exists',
              recommended: true,
            },
          ),
        );
      } else {
        recommended.push(
          buildDownload(
            'win-cpu-arm64',
            'CPU (arm64)',
            'cpu',
            'win-cpu-arm64',
            'zip',
            {
              recommended: true,
            },
          ),
        );
      }
    } else if (hasNvidia(gpuList)) {
      const useCuda13 = nvidiaDriverMajor !== null && nvidiaDriverMajor >= 580;
      const cudaTarget = useCuda13 ? 'win-cuda-13.3-x64' : 'win-cuda-12.4-x64';
      const cudaLabel = useCuda13
        ? 'NVIDIA CUDA 13.3 (x64)'
        : 'NVIDIA CUDA 12.4 (x64)';

      if (nvidiaDriverMajor !== null && nvidiaDriverMajor < 525) {
        warnings.push(
          `NVIDIA driver ${nvidiaDriverMajor} is below 525 — CUDA may not work. Update your GPU driver.`,
        );
      } else if (
        useCuda13 &&
        nvidiaDriverMajor !== null &&
        nvidiaDriverMajor < 580
      ) {
        warnings.push(
          `NVIDIA driver ${nvidiaDriverMajor} is below 580 — CUDA 13.3 requires driver 580+.`,
        );
      }

      recommended.push(
        buildDownload(cudaTarget, cudaLabel, 'cuda', cudaTarget, 'zip', {
          sublabel: 'GPU specific',
          recommended: true,
          files: [
            `llama-${LLAMA_VERSION}-bin-${cudaTarget}.zip`,
            `cudart-llama-bin-${cudaTarget}.zip`,
          ],
          warning:
            nvidiaDriverMajor !== null && nvidiaDriverMajor < 525
              ? `Driver ${nvidiaDriverMajor} is below 525 — update your driver for CUDA 12.4.`
              : undefined,
        }),
      );
    } else if (hasDiscreteGpu(gpuList) || gpuList.length > 0) {
      // Integrated GPU / APU without a vendor-specific backend — Vulkan covers both.
      recommended.push(
        buildDownload(
          'win-vulkan-x64',
          'Vulkan (GPU + CPU) (x64)',
          'vulkan',
          'win-vulkan-x64',
          'zip',
          {
            recommended: true,
            dualIcon: true,
          },
        ),
      );
    } else {
      recommended.push(
        buildDownload('win-cpu-x64', 'CPU (x64)', 'cpu', 'win-cpu-x64', 'zip', {
          recommended: true,
        }),
      );
    }
  } else if (platform === 'linux') {
    if (distro && distro !== 'ubuntu') {
      warnings.push(
        `Non-Ubuntu distro (${distro}) detected. Prebuilt binaries may not work and custom builds may be required. See https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md`,
      );
    }

    if (gpuList.length > 0) {
      recommended.push(
        buildDownload(
          arch === 'arm64' ? 'ubuntu-vulkan-arm64' : 'ubuntu-vulkan-x64',
          arch === 'arm64'
            ? 'Vulkan (GPU + CPU) (arm64)'
            : 'Vulkan (GPU + CPU) (x64)',
          'vulkan',
          arch === 'arm64' ? 'ubuntu-vulkan-arm64' : 'ubuntu-vulkan-x64',
          'tar.gz',
          { recommended: true, dualIcon: true },
        ),
      );
    } else {
      recommended.push(
        buildDownload(
          arch === 'arm64' ? 'ubuntu-arm64' : 'ubuntu-x64',
          arch === 'arm64' ? 'CPU (arm64)' : 'CPU (x64)',
          'cpu',
          arch === 'arm64' ? 'ubuntu-arm64' : 'ubuntu-x64',
          'tar.gz',
          { recommended: true },
        ),
      );
    }
  }

  // Optional: OpenVINO sits at the top of the optional list when an Intel NPU
  // is detected. OpenVINO always carries the experimental tag.
  const optionalTaken = new Set(optional.map((d) => d.folder));

  if (platform !== 'darwin' && intelNpu) {
    const win = platform === 'win32';
    const target = win
      ? 'win-openvino-2026.2.1-x64'
      : 'ubuntu-openvino-2026.2.1-x64';
    optional.push(
      buildDownload(
        target,
        'OpenVINO (NPU) (x64)',
        'openvino',
        target,
        win ? 'zip' : 'tar.gz',
        {
          sublabel: 'Enables NPU support — requires custom code',
          experimental: true,
        },
      ),
    );
    optionalTaken.add(target);
  }

  // Optional: Vulkan backup for NVIDIA systems — CUDA is already recommended
  // on those, so Vulkan only sits in the optional list.
  if (platform === 'win32' && hasNvidia(gpuList)) {
    optional.push(
      buildDownload(
        'win-vulkan-x64',
        'Vulkan (x64)',
        'vulkan',
        'win-vulkan-x64',
        'zip',
        {
          sublabel: 'Backup — also covers CPU',
        },
      ),
    );
    optionalTaken.add('win-vulkan-x64');
  }

  // Optional: vendor-specific accelerators for the detected GPU vendor.
  // The recommended download stays Vulkan (which also covers CPU).
  // A present NVIDIA GPU takes priority: no other vendor's backends are
  // offered, they surface in "Other" tagged "No Valid GPU" instead.
  if (
    (platform === 'win32' || platform === 'linux') &&
    arch === 'x64' &&
    !hasNvidia(gpuList)
  ) {
    if (hasAmd(gpuList)) {
      const win = platform === 'win32';
      const target = win ? 'win-rocm-7.14-x64' : 'ubuntu-rocm-7.14-x64';
      if (!optionalTaken.has(target)) {
        optional.push(
          buildDownload(
            target,
            'ROCm 7.14 (x64)',
            'rocm',
            target,
            win ? 'zip' : 'tar.gz',
            {
              sublabel: 'AMD GPU acceleration',
            },
          ),
        );
        optionalTaken.add(target);
      }
    }

    if (hasIntelGpu(gpuList)) {
      const win = platform === 'win32';
      if (win) {
        if (!optionalTaken.has('win-sycl-x64')) {
          optional.push(
            buildDownload(
              'win-sycl-x64',
              'SYCL (x64)',
              'sycl',
              'win-sycl-x64',
              'zip',
              {
                sublabel: 'Intel GPU acceleration',
              },
            ),
          );
          optionalTaken.add('win-sycl-x64');
        }
      } else {
        if (!optionalTaken.has('ubuntu-sycl-fp16-x64')) {
          optional.push(
            buildDownload(
              'ubuntu-sycl-fp16-x64',
              'SYCL FP16 (x64)',
              'sycl',
              'ubuntu-sycl-fp16-x64',
              'tar.gz',
              {
                sublabel: 'Intel GPU acceleration',
              },
            ),
          );
          optionalTaken.add('ubuntu-sycl-fp16-x64');
        }
        if (!optionalTaken.has('ubuntu-sycl-fp32-x64')) {
          optional.push(
            buildDownload(
              'ubuntu-sycl-fp32-x64',
              'SYCL FP32 (x64)',
              'sycl',
              'ubuntu-sycl-fp32-x64',
              'tar.gz',
              {
                sublabel: 'Intel GPU acceleration (FP32)',
              },
            ),
          );
          optionalTaken.add('ubuntu-sycl-fp32-x64');
        }
      }

      const target = win
        ? 'win-openvino-2026.2.1-x64'
        : 'ubuntu-openvino-2026.2.1-x64';
      if (!optionalTaken.has(target)) {
        optional.push(
          buildDownload(
            target,
            'OpenVINO (x64)',
            'openvino',
            target,
            win ? 'zip' : 'tar.gz',
            {
              sublabel: 'Intel GPU acceleration',
              experimental: true,
            },
          ),
        );
        optionalTaken.add(target);
      }
    }
  }

  optional.push({
    id: 'custom',
    label: 'Custom Binary',
    sublabel: 'Point to your own llama-server build',
    icon: 'custom',
    url: '',
    folder: '',
    files: [],
    recommended: false,
  });

  // "Other": every hardcoded prebuilt binary not already listed, tagged with
  // compatibility notes so the user can still grab whatever they need.
  const taken = new Set(
    [...recommended, ...optional].map((d) => d.folder).filter(Boolean),
  );
  const others: BackendDownload[] = OTHER_TARGETS.filter(
    (t) => !taken.has(t.target),
  ).map((t) =>
    buildDownload(t.id, t.label, t.icon, t.target, t.ext, {
      tags: tagOtherTarget(t, tagContext),
      files: t.cudart
        ? [
            `llama-${LLAMA_VERSION}-bin-${t.target}.${t.ext}`,
            `cudart-llama-bin-${t.target}.zip`,
          ]
        : undefined,
    }),
  );

  // Recommended cards carry the same compatibility tags, so any mismatch
  // (e.g. a stale build selected for this system) is visible up front.
  recommended.forEach((download) => {
    const tags = tagDownload(download, tagContext);
    if (tags) download.tags = tags;
  });

  return {
    platform,
    arch,
    isAppleSilicon,
    defaultDownloadDir:
      loadSettings().backendDirectory ||
      path.join(path.dirname(getModelsDirectory()), 'llama'),
    recommended,
    optional,
    others,
    warnings,
    gpus: gpuList.map((g) => ({
      vendor: g.vendor || 'Unknown',
      model: g.model || 'Unknown',
      vram: parseInt(String(g.vram), 10) || 0,
      vramDynamic:
        typeof g.vramDynamic === 'boolean'
          ? g.vramDynamic
          : String(g.vramDynamic).toLowerCase() === 'true',
      driverVersion: g.driverVersion || '',
    })),
    nvidiaDriverMajor,
    distro,
  };
}
