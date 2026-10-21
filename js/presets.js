// Built-in figures. Angles are degrees relative to the parent segment
// (the root points along rootAngle). Node ids are shared between the
// humanoid presets so poses can be pasted from one to another.
import { DEG } from './geom.js';

const INK = '#1b1b1f';
const FRONT = '#222222';
const BACK = '#000000';

// Stick Nodes-style default: thick limbs, big head, bendy spine, foot nubs.
// Far-side limbs are pure black and drawn first so they sit behind the body.
const stickman = [
  ['root', null],
  ['armR1', 'torso', 44, 81, 'line', 27, BACK],
  ['armR2', 'armR1', 40, 8, 'line', 27, BACK],
  ['legR1', 'root', 70, 133, 'line', 27, BACK],
  ['legR2', 'legR1', 72, 18, 'line', 27, BACK],
  ['footR', 'legR2', 6, -43, 'line', 27, BACK],
  ['spine1', 'root', 28, -11, 'line', 27, FRONT],
  ['spine2', 'spine1', 30, 9, 'line', 27, FRONT],
  ['torso', 'spine2', 30, 12, 'line', 27, FRONT],
  ['neck', 'torso', 10, 0, 'line', 27, FRONT],
  ['head', 'neck', 64, 5, 'filled', 4, FRONT],
  ['legL1', 'root', 70, -145, 'line', 27, FRONT],
  ['legL2', 'legL1', 72, -15, 'line', 27, FRONT],
  ['footL', 'legL2', 5, 22, 'line', 27, FRONT],
  ['armL1', 'torso', 44, -109, 'line', 27, FRONT],
  ['armL2', 'armL1', 40, -5, 'line', 27, FRONT],
];

const humanoid = [
  ['root', null],
  ['torso', 'root', 72, 0, 'line', 11],
  ['head', 'torso', 48, 0, 'filled', 10],
  ['armL1', 'torso', 50, 160, 'line', 10],
  ['armL2', 'armL1', 46, -18, 'line', 10],
  ['armR1', 'torso', 50, -160, 'line', 10],
  ['armR2', 'armR1', 46, 18, 'line', 10],
  ['legL1', 'root', 58, 168, 'line', 11],
  ['legL2', 'legL1', 56, -6, 'line', 11],
  ['legR1', 'root', 58, -168, 'line', 11],
  ['legR2', 'legR1', 56, 6, 'line', 11],
];

const detailed = [
  ['root', null],
  ['torso', 'root', 64, 0, 'line', 13],
  ['neck', 'torso', 12, 0, 'line', 9],
  ['head', 'neck', 50, 0, 'filled', 10],
  ['armL1', 'torso', 48, 160, 'line', 10],
  ['armL2', 'armL1', 44, -18, 'line', 9],
  ['handL', 'armL2', 14, 0, 'filled', 4],
  ['armR1', 'torso', 48, -160, 'line', 10],
  ['armR2', 'armR1', 44, 18, 'line', 9],
  ['handR', 'armR2', 14, 0, 'filled', 4],
  ['legL1', 'root', 58, 168, 'line', 12],
  ['legL2', 'legL1', 54, -6, 'line', 11],
  ['footL', 'legL2', 20, -90, 'line', 10],
  ['legR1', 'root', 58, -168, 'line', 12],
  ['legR2', 'legR1', 54, 6, 'line', 11],
  ['footR', 'legR2', 20, 90, 'line', 10],
];

const ball = [
  ['root', null],
  ['ball', 'root', 60, 0, 'filled', 6, '#ef5350'],
];

const sword = [
  ['root', null],
  ['grip', 'root', 26, 0, 'box', 8, '#6d4c41'],
  ['guardL', 'grip', 16, 90, 'box', 7, '#8d6e63'],
  ['guardR', 'grip', 16, -90, 'box', 7, '#8d6e63'],
  ['blade', 'grip', 110, 0, 'taper', 9, '#b0bec5'],
];

const dog = [
  ['root', null],
  ['spine', 'root', 86, 0, 'line', 14],
  ['neck', 'spine', 30, -50, 'line', 11],
  ['head', 'neck', 34, 40, 'filled', 8],
  ['snout', 'head', 20, 30, 'taper', 12],
  ['frontL1', 'spine', 38, 95, 'line', 9],
  ['frontL2', 'frontL1', 34, -10, 'line', 9],
  ['frontR1', 'spine', 38, 80, 'line', 9],
  ['frontR2', 'frontR1', 34, 10, 'line', 9],
  ['backL1', 'root', 38, 100, 'line', 10],
  ['backL2', 'backL1', 34, -20, 'line', 9],
  ['backR1', 'root', 38, 80, 'line', 10],
  ['backR2', 'backR1', 34, 10, 'line', 9],
  ['tail', 'root', 44, -150, 'taper', 9],
];

export const PRESETS = [
  { id: 'stickman', name: 'Stickman', spec: stickman, rootAngle: -90 * DEG },
  { id: 'stickman-thin', name: 'Thin stickman', spec: humanoid, rootAngle: -90 * DEG },
  { id: 'stickman-pro', name: 'Detailed stickman', spec: detailed, rootAngle: -90 * DEG },
  { id: 'ball', name: 'Ball', spec: ball, rootAngle: -90 * DEG },
  { id: 'sword', name: 'Sword', spec: sword, rootAngle: -90 * DEG },
  { id: 'dog', name: 'Dog', spec: dog, rootAngle: 0 },
];

export function rigFromPreset(preset) {
  return {
    nodes: preset.spec.map(([id, parent, len = 0, ang = 0, shape = 'line', thick = 10, color = INK]) => ({
      id, parent, len, ang: ang * DEG, shape: parent ? shape : 'none', thick, color, art: null,
    })),
  };
}
