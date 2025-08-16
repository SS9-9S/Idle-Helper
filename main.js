const { app, Menu, Tray, BrowserWindow, ipcMain, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const Store = require('electron-store');
const robot = require('robotjs');
const fs = require('fs');

// Resolve an asset for dev and packaged builds
function assetPath(...segs) {
    const dev = path.join(__dirname, ...segs);
    if (fs.existsSync(dev)) return dev;
    const prod = path.join(process.resourcesPath || '', ...segs);
    if (fs.existsSync(prod)) return prod;
    return dev; // fallback
}

const store = new Store({
  defaults: {
    active: false,
    intervalMinutes: 5,
    intervalVariance: 0.3,
    radiusMin: 60,
    radiusMax: 140,
    moveDurationMsMin: 1200,
    moveDurationMsMax: 2500,
    jitterPx: 1.5,
    skipChance: 0.12,
    startAtLogin: false
  }
});

let tray = null;
let prefWin = null;
let moveTimer = null;
let isMoving = false;
let nextAt = null;

const ICON_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAhUlEQVR4nO2W2w6AMAhDq///z/ps3Lit" +
  "6Q8j1kTQz1w8yLo0/W7hTAl6E5dZz6q1mQTHzi8A7O8x2fT0kJd7kXr4kq7i2xKJg2Q+0s0+q2H1JgG" +
  "f4V2d3Yqz9M1X9RheP8u4Q+3D0a0ylU5l1qf0yQ2u9cQtJcJ5sH8p7lP5rLwZL9nJXw0H2Q6t6F9LVY" +
  "Z5eNwJ9oT4lCw1+H8k7a2w7t6D0Iu0QH5h9oYF+qFfUox4b0gAAAABJRU5ErkJggg==";
function createTray() {
    let trayImage;

    if (process.platform === 'win32') {
        // Use multi-size .ico in Windows tray
        const ico = assetPath('renderer', 'icons', 'idlehelper.ico');
        trayImage = nativeImage.createFromPath(ico);
    } else if (process.platform === 'darwin') {
        // Use monochrome template PNG so macOS auto-tints for light/dark
        const tpl = assetPath('renderer', 'icons', 'tray_template.png');
        trayImage = nativeImage.createFromPath(tpl);
        if (!trayImage.isEmpty()) trayImage.setTemplateImage(true);
    } else {
        // Linux fallback: a regular PNG (32px works fine)
        const png32 = assetPath('renderer', 'icons', 'icon_32x32.png');
        trayImage = nativeImage.createFromPath(png32);
    }

    if (!trayImage || trayImage.isEmpty()) {
        console.error('Tray icon not found — check files in renderer/icons');
    }

    tray = new Tray(trayImage);
    updateTrayMenu();
}

function openPrefs() {
    if (prefWin) { prefWin.show(); prefWin.focus(); return; }

    const winIcon = process.platform === 'win32'
        ? assetPath('renderer', 'icons', 'idlehelper.ico')
        : process.platform === 'darwin'
            ? assetPath('renderer', 'icons', 'IdleHelper.icns')
            : assetPath('renderer', 'icons', 'icon_128x128.png'); // linux/png

    prefWin = new BrowserWindow({
        width: 460,
        height: 480,
        resizable: false,
        title: "Idle Helper Preferences",
        icon: winIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    prefWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    prefWin.on('closed', () => { prefWin = null; });
}


function updateTrayMenu() {
  const active = !!store.get('active');
  const template = [
    { label: active ? 'Pause' : 'Start', click: () => setActive(!active) },
    { label: 'Preferences…', click: () => openPrefs() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ];
  tray.setToolTip(active ? 'Idle Helper — Active' : 'Idle Helper — Paused');
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function setActive(v) {
  store.set('active', !!v);
  updateTrayMenu();
  if (v) {
    scheduleNextMove(true);
  } else {
    if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
    nextAt = null;
  }
  prefWin?.webContents.send('status', getStatus());
  app.setLoginItemSettings({ openAtLogin: !!store.get('startAtLogin') });
}

function getStatus() {
  return { active: !!store.get('active'), nextAt: nextAt ? new Date(nextAt).toISOString() : null };
}

function scheduleNextMove(reset = false) {
  if (!store.get('active')) return;
  if (moveTimer) clearTimeout(moveTimer);

  const base = Math.max(1, Number(store.get('intervalMinutes'))) * 60 * 1000;
  const varFrac = Math.max(0, Math.min(0.9, Number(store.get('intervalVariance'))));
  const jitter = (Math.random() * 2 - 1) * varFrac;
  let wait = base * (1 + jitter);

  if (!reset) {
    const skipChance = Number(store.get('skipChance')) || 0;
    if (Math.random() < skipChance) wait += base; // occasionally skip a cycle
  }

  nextAt = Date.now() + wait;
  moveTimer = setTimeout(() => doMove().catch(console.error), wait);
  prefWin?.webContents.send('status', getStatus());
}

function ease(t) { return t * t * (3 - 2 * t); }

function smoothMove(x1, y1, x2, y2, durationMs, jitterPx = 1) {
  return new Promise(resolve => {
    const steps = Math.max(30, Math.floor(durationMs / 16)); // ~60fps
    for (let i = 0; i <= steps; i++) {
      setTimeout(() => {
        const t = ease(i / steps);
        const nx = x1 + (x2 - x1) * t + ((Math.random() * 2 - 1) * jitterPx);
        const ny = y1 + (y2 - y1) * t + ((Math.random() * 2 - 1) * jitterPx);
        robot.moveMouse(Math.round(nx), Math.round(ny));
        if (i === steps) resolve();
      }, (durationMs / steps) * i);
    }
  });
}

async function doMove() {
  if (!store.get('active')) return;
  if (isMoving) { scheduleNextMove(); return; }
  isMoving = true;

  try {
    const screen = robot.getScreenSize();
    const pos = robot.getMousePos();

    const rmin = Math.max(10, Number(store.get('radiusMin')));
    const rmax = Math.max(rmin + 10, Number(store.get('radiusMax')));
    const radius = rmin + Math.random() * (rmax - rmin);
    const angle = Math.random() * Math.PI * 2;

    let tx = pos.x + Math.cos(angle) * radius;
    let ty = pos.y + Math.sin(angle) * radius;

    tx = Math.max(2, Math.min(screen.width - 2, tx));
    ty = Math.max(2, Math.min(screen.height - 2, ty));

    const dmin = Math.max(800, Number(store.get('moveDurationMsMin')));
    const dmax = Math.max(dmin + 200, Number(store.get('moveDurationMsMax')));
    const duration = dmin + Math.random() * (dmax - dmin);

    await smoothMove(pos.x, pos.y, tx, ty, duration, Number(store.get('jitterPx')) || 0);
  } finally {
    isMoving = false;
    scheduleNextMove();
  }
}

ipcMain.handle('settings:get', () => store.store);
ipcMain.handle('settings:set', (_evt, changes) => {
  store.store = { ...store.store, ...changes };
  updateTrayMenu();
  app.setLoginItemSettings({ openAtLogin: !!store.get('startAtLogin') });
  return store.store;
});
ipcMain.handle('control:start', () => { setActive(true); return getStatus(); });
ipcMain.handle('control:stop', () => { setActive(false); return getStatus(); });
ipcMain.handle('status:get', () => getStatus());

app.whenReady().then(() => {
    // macOS dock icon
    if (process.platform === 'darwin') {
        const dockIcon = nativeImage.createFromPath(
            assetPath('renderer', 'icons', 'IdleHelper.icns')
        );
        if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    }

    createTray();
    openPrefs(); // show on first launch
    updateTrayMenu();

    try { globalShortcut.register('Control+Shift+M', () => setActive(!store.get('active'))); }
    catch (e) { console.warn('Global shortcut failed:', e); }

    if (store.get('startAtLogin') && store.get('active')) scheduleNextMove(true);
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => globalShortcut.unregisterAll());
