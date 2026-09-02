import { getProject } from '@theatre/core';

let project, sheet, heroCameraObj;

try {
  project = getProject('Wedding');
  sheet = project.sheet('Wedding');
  heroCameraObj = sheet.object('Hero Camera', {
    position: { x: 0, y: 0, z: 5.5 },
  });
  // Studio UI intentionally disabled — enable manually if needed for animation editing
} catch (e) {
  console.warn('[Theatre.js] Could not initialize:', e?.message);
}

export { project, sheet, heroCameraObj };
