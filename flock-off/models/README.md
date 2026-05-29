# Sheep model

Place `sheep.glb` in this directory.

## Recommended source

**Quaternius — Ultimate Animated Animals** (CC0 / public domain)  
https://quaternius.com/packs/ultimateanimatedanimals.html

Download the pack, find `Sheep.glb` (or equivalent), rename it to `sheep.glb`,
and drop it here.

## Requirements for SheepManager.ts

| Property | Requirement |
|---|---|
| Format | GLB / GLTF |
| Rig | SkinnedMesh with skeleton |
| Animations | At least one clip; ideally "Idle", "Walk", "Run" |
| Scale | Any — auto-scaled to 0.9 world units tall at load time |
| Origin | Feet at Y = 0 preferred; otherwise offset looks slightly off |

## Animation clip naming

SheepManager searches for clips by case-insensitive substring:

| State | Keywords searched |
|---|---|
| Idle | `idle`, `stand`, `rest` |
| Walk | `walk`, `trot`, `move` |
| Run  | `run`, `gallop`, `sprint` |

If none match, the first clip in the file is used for all states.

## Sketchfab alternative

Search https://sketchfab.com for **"sheep rigged"**, filter to
**Downloadable**, and export as glTF. Many free CC models are available.
