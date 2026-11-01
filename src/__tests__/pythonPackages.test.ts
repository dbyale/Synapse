import {
  PYTHON_AUTO_INSTALL_MAP,
  PYTHON_PACKAGES,
  PYTHON_PACKAGES_APPROX_BYTES,
  findPythonPackage,
} from '../main/pythonPackages';

describe('Python package manifest', () => {
  it('uses unique ids and import names', () => {
    const ids = PYTHON_PACKAGES.map((pkg) => pkg.id);
    const imports = PYTHON_PACKAGES.map((pkg) => pkg.importName);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(imports).size).toBe(imports.length);
  });

  it('describes every package for the UI and pip', () => {
    PYTHON_PACKAGES.forEach((pkg) => {
      expect(pkg.id.trim()).not.toBe('');
      expect(pkg.pip.trim()).not.toBe('');
      expect(pkg.importName.trim()).not.toBe('');
      expect(pkg.label.trim()).not.toBe('');
      expect(pkg.approxBytes).toBeGreaterThan(0);
    });
  });

  it('derives the lazy auto-install map from the same manifest', () => {
    expect(Object.keys(PYTHON_AUTO_INSTALL_MAP)).toHaveLength(
      PYTHON_PACKAGES.length,
    );

    PYTHON_PACKAGES.forEach((pkg) => {
      expect(PYTHON_AUTO_INSTALL_MAP[pkg.importName]).toEqual({
        pip: pkg.pip,
        importName: pkg.importName,
      });
    });
  });

  it('exposes a total size hint', () => {
    expect(PYTHON_PACKAGES_APPROX_BYTES).toBeGreaterThan(0);
  });

  it('installs the user-visible tools before the scientific stack', () => {
    // Ordering is meaningful: setup installs sequentially, so the first
    // entries become usable first.
    expect(PYTHON_PACKAGES.slice(0, 2).map((pkg) => pkg.id)).toEqual([
      'markitdown',
      'ddgs',
    ]);
  });

  it('resolves packages by id, requirement, or import name', () => {
    const numpy = PYTHON_PACKAGES.find((pkg) => pkg.id === 'numpy');
    const sklearn = PYTHON_PACKAGES.find((pkg) => pkg.id === 'scikit-learn');
    expect(numpy).toBeDefined();
    expect(sklearn).toBeDefined();

    expect(findPythonPackage('numpy')?.id).toBe('numpy');
    expect(findPythonPackage('Numpy')?.id).toBe('numpy');
    expect(findPythonPackage('Pillow')?.id).toBe('pillow');
    expect(findPythonPackage('scikit-learn', 'sklearn')?.id).toBe(
      'scikit-learn',
    );
    expect(findPythonPackage('markitdown==0.0.2', 'markitdown')?.id).toBe(
      'markitdown',
    );
    expect(findPythonPackage('not-a-package')).toBeUndefined();
  });
});
