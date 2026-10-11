# Install Design Claw

## Update your existing extension

1. Back up your current extension folder.
2. Copy the contents of this package into that **same folder**, replacing the old files. Keep its path unchanged so Chrome retains the extension's identity and stored references.
3. Open `chrome://extensions` and click **Reload** on Design Claw / Design Compositor.
4. Close the old side panel, reopen it from the toolbar icon, and check your references.

Do not remove the old extension before updating: removing an extension can remove its stored data. This release retains the existing database name and metadata format.

## First installation

1. Unzip the package to a folder you will keep.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Pin Design Claw in Chrome's Extensions menu.
5. Open a website, click its toolbar icon, and choose Pick element or Capture area.

Capture and compile work without an API key. Configure a provider only if you want optional AI creative direction. Click the toolbar icon on each new tab/site before capturing.

## Quick acceptance check

Capture an element, then capture an area spanning two screens using the 2-second edge hold. Open the tall crop in the inspector, reopen the panel, and export a ZIP. It should retain both images. Native Chrome access grants and side-panel behavior need this final check on your machine; the included browser integration test uses a Chrome API bridge.

## Try the new workbench

1. On a website, choose Scan visible page styles, then Pick next to a useful sample. Click the highlighted element to save its image and measured CSS.
2. Choose a measured Base reference, compile, and use Download CSS or Export bundle. Extract the bundle and open BOARD.html locally.
3. In Project backup & import, download a backup before moving collections between installations. Import adds references and keeps the existing base. Keep backups somewhere private; they include your captured images and notes.
4. Open a freshly captured reference to review its advisory text contrast result. Unknown means more evidence is needed.

## Check the 0.4 studio

After Reload, the toolbar should show the new framing/claw mark rather than a letter D. If Chrome still shows a cached icon, close and reopen the panel or restart Chrome.

Open a captured reference, name it, and set Borrow/Avoid. Fill in an audience and primary action, then open the studio: the board and starting brief should transfer. Compile and verify that the exported kit contains SYSTEM.md, BUILD-PLAN.md and REVIEW-CHECKLIST.md.

Save a named collection, remove a reference from the current board, and add the saved collection: its independent image should still be retrievable. Saved collections are local to this extension installation. Use project backups before moving or uninstalling it.
