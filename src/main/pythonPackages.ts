/**
 * Single source of truth for the Python packages Synapse tools rely on.
 *
 * Both the onboarding installer and the runtime auto-install path read from
 * this list, so the libraries advertised to the model can never drift from
 * the libraries setup actually installs.
 */

export type PythonPackageGroup =
  | 'scientific'
  | 'plotting'
  | 'http'
  | 'search'
  | 'documents'
  | 'other';

export interface PythonPackageSpec {
  /** Stable identifier used by IPC, settings, and the UI. */
  id: string;
  /** pip requirement string — may include extras (e.g. markitdown[...]). */
  pip: string;
  /** Module name used for the import probe. */
  importName: string;
  /** Human-readable name shown in setup. */
  label: string;
  group: PythonPackageGroup;
  /** Rough download estimate used for the setup-size hint. */
  approxBytes: number;
}

export const PYTHON_PACKAGE_GROUP_LABELS: Record<PythonPackageGroup, string> = {
  scientific: 'Scientific computing',
  plotting: 'Plotting & images',
  http: 'HTTP',
  search: 'Web search',
  documents: 'Document conversion',
  other: 'Other',
};

const MB = 1024 * 1024;

export const PYTHON_PACKAGES: PythonPackageSpec[] = [
  {
    id: 'numpy',
    pip: 'numpy',
    importName: 'numpy',
    label: 'NumPy',
    group: 'scientific',
    approxBytes: 22 * MB,
  },
  {
    id: 'pandas',
    pip: 'pandas',
    importName: 'pandas',
    label: 'Pandas',
    group: 'scientific',
    approxBytes: 13 * MB,
  },
  {
    id: 'scipy',
    pip: 'scipy',
    importName: 'scipy',
    label: 'SciPy',
    group: 'scientific',
    approxBytes: 48 * MB,
  },
  {
    id: 'scikit-learn',
    pip: 'scikit-learn',
    importName: 'sklearn',
    label: 'scikit-learn',
    group: 'scientific',
    approxBytes: 32 * MB,
  },
  {
    id: 'statsmodels',
    pip: 'statsmodels',
    importName: 'statsmodels',
    label: 'statsmodels',
    group: 'scientific',
    approxBytes: 12 * MB,
  },
  {
    id: 'sympy',
    pip: 'sympy',
    importName: 'sympy',
    label: 'SymPy',
    group: 'scientific',
    approxBytes: 7 * MB,
  },
  {
    id: 'matplotlib',
    pip: 'matplotlib',
    importName: 'matplotlib',
    label: 'Matplotlib',
    group: 'plotting',
    approxBytes: 9 * MB,
  },
  {
    id: 'pillow',
    pip: 'Pillow',
    importName: 'PIL',
    label: 'Pillow',
    group: 'plotting',
    approxBytes: 3 * MB,
  },
  {
    id: 'networkx',
    pip: 'networkx',
    importName: 'networkx',
    label: 'NetworkX',
    group: 'plotting',
    approxBytes: 2 * MB,
  },
  {
    id: 'requests',
    pip: 'requests',
    importName: 'requests',
    label: 'Requests',
    group: 'http',
    approxBytes: 1 * MB,
  },
  {
    id: 'httpx',
    pip: 'httpx',
    importName: 'httpx',
    label: 'HTTPX',
    group: 'http',
    approxBytes: 1 * MB,
  },
  {
    id: 'ddgs',
    pip: 'ddgs',
    importName: 'ddgs',
    label: 'ddgs (web search)',
    group: 'search',
    approxBytes: 4 * MB,
  },
  {
    id: 'markitdown',
    // MarkItDown 0.1.x depends on magika → onnxruntime, which has no wheels
    // for the managed CPython 3.15. 0.0.2 declares its PDF/DOCX/PPTX/XLSX/XLS
    // and audio converters as regular dependencies, so it installs and works
    // on every runtime Synapse supports.
    pip: 'markitdown==0.0.2',
    importName: 'markitdown',
    label: 'MarkItDown (documents)',
    group: 'documents',
    approxBytes: 90 * MB,
  },
];

/** Total approximate download size for the "about X MB" setup hint. */
export const PYTHON_PACKAGES_APPROX_BYTES = PYTHON_PACKAGES.reduce(
  (sum, pkg) => sum + pkg.approxBytes,
  0,
);

/**
 * Top-level import → pip mapping for lazy auto-install at runtime.
 * Derived from PYTHON_PACKAGES so setup and runtime stay in sync.
 */
export const PYTHON_AUTO_INSTALL_MAP: Record<
  string,
  { pip: string; importName: string }
> = PYTHON_PACKAGES.reduce(
  (map, pkg) => {
    map[pkg.importName] = { pip: pkg.pip, importName: pkg.importName };
    return map;
  },
  {} as Record<string, { pip: string; importName: string }>,
);

export function findPythonPackage(
  idOrRequirement: string,
  importName?: string,
): PythonPackageSpec | undefined {
  const normalized = idOrRequirement.toLowerCase();
  return PYTHON_PACKAGES.find(
    (pkg) =>
      pkg.id.toLowerCase() === normalized ||
      pkg.pip.toLowerCase() === normalized ||
      (importName !== undefined &&
        pkg.importName.toLowerCase() === importName.toLowerCase()),
  );
}
