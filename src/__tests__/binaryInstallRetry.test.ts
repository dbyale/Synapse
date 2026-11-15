// The download manager's Retry/Resume buttons are model-shaped, so a failed
// backend row gets rerouted through these helpers instead. What has to hold:
// the retry reuses the binary descriptor and the directory of the install it
// belongs to, and it re-registers the progress mapping so the backend card
// follows the transfer again.
import type { BackendDownload, DownloadProgress } from '../renderer/preload.d';
import {
  findBinaryInstall,
  getBinaryInstallSnapshot,
  removeBinaryInstall,
  retryBinaryDownload,
  startBinaryInstall,
} from '../renderer/onboarding/backgroundInstalls';

const downloadBinary = jest.fn(() => Promise.resolve('C:\\llama\\ok'));
let emit: ((progress: DownloadProgress) => void) | null = null;

beforeAll(() => {
  window.electronAPI = {
    downloadBinary,
    // The module registers one listener for the whole session; keeping the
    // callback here lets a test broadcast events as if the main process sent them.
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
      emit = callback;
      return () => {
        emit = null;
      };
    },
    onPythonPackagesProgress: () => () => undefined,
  } as unknown as typeof window.electronAPI;
});

beforeEach(() => {
  // mockClear would keep a previous test's rejecting implementation, so the
  // happy path is re-installed for every test.
  downloadBinary.mockReset();
  downloadBinary.mockImplementation(() => Promise.resolve('C:\\llama\\ok'));
});

// Let queued promise callbacks run (a rejected install reports itself on the
// following ticks). Microtasks only — no timers to leave behind.
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

function makeDownload(id: string, folder: string): BackendDownload {
  return {
    id,
    label: `${id} build`,
    sublabel: folder,
    icon: 'cuda',
    url: 'https://example.invalid/llama.zip',
    folder,
    files: ['llama.zip', 'cudart.zip'],
    recommended: true,
  };
}

function progressOf(
  download: BackendDownload,
  progress: Partial<DownloadProgress>,
): DownloadProgress {
  return {
    modelId: download.id,
    filename: download.label,
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    ...progress,
  };
}

function emitProgress(
  download: BackendDownload,
  progress: Partial<DownloadProgress>,
): void {
  if (!emit) throw new Error('no download-progress listener registered');
  emit(progressOf(download, progress));
}

describe('binary install retries', () => {
  it('re-downloads a failed backend through the binary installer', async () => {
    const download = makeDownload('win-cuda-retry-x64', 'win-cuda-retry-x64');
    await startBinaryInstall('backend', download, 'C:\\llama\\first');

    emitProgress(download, {
      status: 'failed',
      error: 'socket hang up',
      downloadedBytes: 4096,
    });
    expect(getBinaryInstallSnapshot('backend', download.id)?.status).toBe(
      'failed',
    );

    // Same descriptor and same target directory, and it must not fall through to
    // the model downloader, which has no idea what this id is. The pending
    // promise keeps the retry in flight while the snapshot is inspected.
    let settleRetry: (path: string) => void = () => undefined;
    downloadBinary.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          settleRetry = resolve;
        }),
    );
    expect(retryBinaryDownload(download.id)).toBe(true);
    expect(downloadBinary).toHaveBeenCalledTimes(2);
    expect(downloadBinary).toHaveBeenLastCalledWith(
      'backend',
      expect.objectContaining({ id: download.id }),
      'C:\\llama\\first',
    );
    expect(getBinaryInstallSnapshot('backend', download.id)?.status).toBe(
      'downloading',
    );

    // Progress events reach the fresh snapshot too: the row and the card both
    // come back to life after the retry.
    emitProgress(download, {
      downloadedBytes: 500,
      totalBytes: 1000,
      percent: 50,
    });
    const after = getBinaryInstallSnapshot('backend', download.id);
    expect(after?.status).toBe('downloading');
    expect(after?.percent).toBe(50);

    settleRetry('C:\\llama\\first\\win-cuda-retry-x64');
    await flush();
    expect(getBinaryInstallSnapshot('backend', download.id)?.status).toBe(
      'completed',
    );
  });

  it('reports a retry as handled when the re-download fails again', async () => {
    const download = makeDownload('win-cuda-fail-x64', 'win-cuda-fail-x64');
    await startBinaryInstall('backend', download, 'C:\\llama');

    downloadBinary.mockImplementationOnce(() =>
      Promise.reject(new Error('404')),
    );
    // Handled by the binary path either way: falling back to the model
    // downloader here would ask for a repo that does not exist.
    expect(retryBinaryDownload(download.id)).toBe(true);
    await flush();
    expect(getBinaryInstallSnapshot('backend', download.id)?.status).toBe(
      'failed',
    );
    expect(getBinaryInstallSnapshot('backend', download.id)?.error).toBe('404');
  });

  it('declines rows it has no install for, and matches by folder', async () => {
    const download = makeDownload('win-vulkan-id', 'win-vulkan-folder');
    await startBinaryInstall('backend', download, 'C:\\llama');

    // An install from an older build can be keyed by its marker id or its
    // folder, and the download manager only knows one of them.
    expect(findBinaryInstall('win-vulkan-folder')?.id).toBe('win-vulkan-id');

    expect(retryBinaryDownload('some-huggingface-repo')).toBe(false);
    expect(downloadBinary).toHaveBeenCalledTimes(1);
  });

  it('tracks unpacking as a stage of the same install', async () => {
    const download = makeDownload('win-cuda-unzip-x64', 'win-cuda-unzip-x64');
    await startBinaryInstall('backend', download, 'C:\\llama');

    emitProgress(download, {
      status: 'extracting',
      downloadedBytes: 1200,
      totalBytes: 2000,
      percent: 60,
    });
    const unpacking = getBinaryInstallSnapshot('backend', download.id);
    expect(unpacking?.status).toBe('extracting');
    expect(unpacking?.totalBytes).toBe(2000);

    emitProgress(download, { status: 'completed' });
    expect(getBinaryInstallSnapshot('backend', download.id)?.status).toBe(
      'completed',
    );
  });

  it('does not pop the download manager open for a backend install', async () => {
    const opened = jest.fn();
    const download = makeDownload('win-cuda-quiet-x64', 'win-cuda-quiet-x64');
    window.addEventListener('open-download-manager', opened);

    await startBinaryInstall('backend', download, 'C:\\llama');
    removeBinaryInstall('backend', download.id);

    window.removeEventListener('open-download-manager', opened);
    expect(opened).not.toHaveBeenCalled();
  });
});
