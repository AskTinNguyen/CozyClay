#!/usr/bin/env node
// colour-script A1 (export draw): a frame captured from a shot whose look is lit
// by an environment map (overcast, interior) gets that map for the draw even
// while the playhead shows a studio-look shot, and the scene is put back after;
// the frame of the shot on screen leaves the scene alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyShotLookForDraw, lookSignature } from '../src/stage-shot-look-draw.js';
import { shotLookAt } from '../src/stage-shot-look.js';
import { stageLook } from '../src/stage-lighting.js';
import { lookRecipe } from '../src/colour-script/recipes.js';

function rig(frame) {
  const stage = { lighting: null, keyLight: null };
  const shots = [{ id: 'studio', startFrame: 0, endFrame: 47 }, { id: 'overcast', startFrame: 48, endFrame: 95, look: lookRecipe('cold-isolation').look }];
  const scene = new THREE.Scene(), texture = new THREE.Texture(), built = [];
  scene.fog = new THREE.Fog('#202020', 20, 50);
  scene.background = new THREE.Color('#202020');
  const onScreen = shotLookAt(stage, shots, 10), shownEnv = stageLook({ ...onScreen, theme: 'dark', grid: false }).env;
  scene.userData.shotLook = { at: (f, list) => shotLookAt(stage, list ?? shots, f), frameRef: { current: frame }, shown: lookSignature(onScreen), shownEnv: shownEnv ? JSON.stringify(shownEnv) : null,
    envMap: (spec) => { built.push(spec); return texture; }, theme: 'dark', grid: false, keyColor: (key) => key.color ?? '#ffffff', sky: () => null };
  return { scene, texture, built, shownEnv };
}

test('an overcast shot exported while a studio shot is on screen draws with its environment map', () => {
  const { scene, texture, built, shownEnv } = rig(70);
  assert.equal(shownEnv, null, 'the studio look on screen has no environment map');
  const restore = applyShotLookForDraw(scene);
  assert.equal(scene.environment, texture, 'the frame draws with the overcast look\'s map');
  assert.equal(built.length, 1);
  assert.ok(scene.environmentIntensity > 0);
  restore();
  assert.equal(scene.environment, null, 'the map on screen is put back');
  assert.equal(scene.environmentIntensity, 1);
});

test('a frame of the shot on screen leaves the scene alone', () => {
  const { scene, built } = rig(10);
  applyShotLookForDraw(scene)();
  assert.equal(scene.environment, null);
  assert.equal(built.length, 0);
});
