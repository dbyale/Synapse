import {
  app,
  Menu,
  shell,
  BrowserWindow,
  MenuItemConstructorOptions,
} from 'electron';

interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string;
  submenu?: DarwinMenuItemConstructorOptions[] | Menu;
}

export interface MenuEditState {
  canCopy: boolean;
  canCut: boolean;
  canPaste: boolean;
  canDelete: boolean;
}

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  menu: Menu | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  buildMenu(): Menu {
    this.setupContextMenu();

    const template =
      process.platform === 'darwin'
        ? this.buildDarwinTemplate()
        : this.buildDefaultTemplate();

    const menu = Menu.buildFromTemplate(template);
    this.menu = menu;
    Menu.setApplicationMenu(menu);

    return menu;
  }

  updateEditItemState(state: MenuEditState): void {
    const { menu } = this;
    if (!menu) return;

    const set = (id: string, enabled: boolean) => {
      const item = menu.getMenuItemById(id);
      if (item) {
        item.enabled = enabled;
      }
    };

    set('edit-copy', state.canCopy);
    set('edit-cut', state.canCut);
    set('edit-paste', state.canPaste);
    set('edit-delete', state.canDelete);
  }

  setupContextMenu(): void {
    const isDev =
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true';

    this.mainWindow.webContents.on('context-menu', (_, props) => {
      const { x, y, editFlags } = props;

      const template: MenuItemConstructorOptions[] = [
        {
          label: 'Copy',
          enabled: editFlags.canCopy,
          click: () => {
            this.mainWindow.webContents.copy();
          },
        },
        {
          label: 'Cut',
          enabled: editFlags.canCut,
          click: () => {
            this.mainWindow.webContents.cut();
          },
        },
        {
          label: 'Paste',
          enabled: editFlags.canPaste,
          click: () => {
            this.mainWindow.webContents.paste();
          },
        },
      ];

      if (isDev) {
        template.push(
          { type: 'separator' },
          {
            label: 'Inspect element',
            click: () => {
              this.mainWindow.webContents.inspectElement(x, y);
            },
          },
        );
      }

      Menu.buildFromTemplate(template).popup({ window: this.mainWindow });
    });
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: DarwinMenuItemConstructorOptions = {
      label: 'Electron',
      submenu: [
        {
          label: 'About ElectronReact',
          selector: 'orderFrontStandardAboutPanel:',
        },
        { type: 'separator' },
        { label: 'Services', submenu: [] },
        { type: 'separator' },
        {
          label: 'Hide ElectronReact',
          accelerator: 'Command+H',
          selector: 'hide:',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        { label: 'Show All', selector: 'unhideAllApplications:' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    };
    const subMenuEdit: DarwinMenuItemConstructorOptions = {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Command+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+Command+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Command+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'Command+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'Command+V', selector: 'paste:' },
        {
          label: 'Select All',
          accelerator: 'Command+A',
          selector: 'selectAll:',
        },
      ],
    };
    const subMenuView: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          },
        },
      ],
    };
    const subMenuWindow: DarwinMenuItemConstructorOptions = {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Command+M',
          selector: 'performMiniaturize:',
        },
        { label: 'Close', accelerator: 'Command+W', selector: 'performClose:' },
        { type: 'separator' },
        { label: 'Bring All to Front', selector: 'arrangeInFront:' },
      ],
    };

    return [
      subMenuAbout,
      this.buildEditTemplate(),
      subMenuEdit,
      this.buildNavigateTemplate(),
      subMenuView,
      subMenuWindow,
      this.buildReportIssueTemplate(),
    ];
  }

  buildEditTemplate(): MenuItemConstructorOptions {
    const fileItem = (
      id: string,
      label: string,
      accelerator: string,
      click: () => void,
    ): MenuItemConstructorOptions => ({
      id,
      label,
      accelerator,
      registerAccelerator: false,
      enabled: false,
      click,
    });

    return {
      label: '&File',
      submenu: [
        fileItem('edit-copy', 'Copy', 'CmdOrCtrl+C', () =>
          this.mainWindow.webContents.copy(),
        ),
        fileItem('edit-cut', 'Cut', 'CmdOrCtrl+X', () =>
          this.mainWindow.webContents.cut(),
        ),
        fileItem('edit-paste', 'Paste', 'CmdOrCtrl+V', () =>
          this.mainWindow.webContents.paste(),
        ),
        fileItem('edit-delete', 'Delete', 'Delete', () =>
          this.mainWindow.webContents.delete(),
        ),
      ],
    };
  }

  buildNavigateTemplate(): MenuItemConstructorOptions {
    const pages: { label: string; path: string }[] = [
      { label: 'Chat', path: '/' },
      { label: 'Profiles', path: '/profiles' },
      { label: 'Models', path: '/models' },
      { label: 'Extensions', path: '/extensions' },
      { label: 'Workflows', path: '/workflows' },
      { label: 'Settings', path: '/settings' },
    ];

    return {
      label: 'Navigate',
      submenu: pages.map((page) => ({
        label: page.label,
        click: () => {
          this.mainWindow.webContents.send('menu:navigate', page.path);
        },
      })),
    };
  }

  buildFullScreenTemplate(label: string): MenuItemConstructorOptions {
    return {
      label,
      submenu: [
        {
          label: 'Toggle Full Screen',
          accelerator: process.platform === 'darwin' ? 'Ctrl+Command+F' : 'F11',
          click: () => {
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
          },
        },
      ],
    };
  }

  // eslint-disable-next-line class-methods-use-this
  buildReportIssueTemplate(): MenuItemConstructorOptions {
    return {
      label: 'Help',
      submenu: [
        {
          label: 'Report an Issue',
          click() {
            shell.openExternal('https://github.com/dbyale/Synapse/issues');
          },
        },
      ],
    };
  }

  buildDefaultTemplate() {
    const templateDefault = [
      this.buildEditTemplate(),
      this.buildNavigateTemplate(),
      this.buildFullScreenTemplate('&View'),
      this.buildReportIssueTemplate(),
    ];

    return templateDefault;
  }
}
