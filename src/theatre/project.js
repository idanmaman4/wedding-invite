import { getProject } from '@theatre/core';
import studio from '@theatre/studio';

// Only initialize studio in development mode
if (import.meta.env.DEV) {
  studio.initialize();
}

// Main project — represents the entire wedding animation timeline
export const project = getProject('Wedding');

// Sheet for the wedding sequence
export const sheet = project.sheet('Wedding');

// Hero camera object — animatable via Theatre.js Studio
export const heroCameraObj = sheet.object('Hero Camera', {
  position: { x: 0, y: 0, z: 5.5 },
});
