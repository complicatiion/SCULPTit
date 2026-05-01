# SCULPTit Documentation

SCULPTit is an offline-capable browser-based digital-clay sculpting prototype. It runs from a small local web server and does not require external CDN resources in this package.

## Start

- Run `start_SCULPTit.bat` on Windows.
- The script starts a local server and opens `http://localhost:8000` in your default browser.
- Keep the console window open while using SCULPTit.

## Navigation

- **LMB:** Sculpt with the active brush.
- **RMB:** Orbit / rotate the view.
- **MMB:** Pan the view.
- **Mouse Wheel:** Zoom.
- **Shift:** Temporarily switch to Smooth.
- **Alt + LMB:** Orbit instead of sculpting. With Pull, Alt also inverts Pull into Push.
- **F:** Frame the full scene in the viewport.

## Sculpt Tools

- **Pull:** Raises the surface along the brush normal.
- **Push:** Pushes the surface inward.
- **Clay:** Builds controlled material layers.
- **Inflate:** Expands the surface along vertex normals.
- **Flatten:** Projects the affected area toward an average plane.
- **Smooth:** Relaxes the surface and reduces rough transitions.
- **Pinch:** Pulls vertices toward the brush center and tightens forms.
- **Crease:** Cuts a sharper groove into the surface.
- **Scrape:** Trims high points, useful for planar cuts.
- **Grab:** Moves a region with the pointer movement.
- **Twist:** Rotates the affected surface around the brush normal.
- **Noise:** Adds controlled surface breakup.
- **Relax:** Smooths topology with a softer effect than Smooth.
- **Mask:** Paints protected areas. Masked vertices are less affected by most tools.
- **Erase Mask:** Removes painted mask values.
- **Dent:** Stronger inward sculpting for cuts and depressions.
- **Ridge:** Builds a raised crease-like stroke.
- **Polish:** Flattens and lightly smooths the area.
- **Smear:** Drags surface material in the stroke direction.
- **Move:** Stronger region movement than Grab.
- **Scale:** Expands or contracts the affected region from the brush center.

## Brush Settings

- **Radius:** Brush size in scene units.
- **Strength:** Brush intensity per stroke step.
- **Falloff / Hardness:** Controls the brush edge. Lower values are softer, higher values are harder.
- **Stroke Spacing:** Controls how often brush samples are applied while dragging.
- **X-Symmetry:** Mirrors sculpt strokes across the X axis.

## Layers

The left-side Layers card lets you add multiple primitive layers to the scene. The active layer is highlighted. Sculpting affects only the selected active layer, while export and scene framing include all visible layers.

- **Add Layer:** Adds the currently selected primitive as a new scene layer.
- **Delete:** Removes the active layer. At least one layer remains in the scene.
- **New:** Replaces the active layer with the selected primitive.

## Primitives and Detail

The Primitives section provides common base meshes: sphere, cube, plane, cylinder, cone, and torus. **Detail Resolution** controls the initial mesh density for newly created primitives. **Subdivide +1** increases the active layer by splitting each triangle into four smaller triangles.

## Viewport

- **Wireframe Overlay:** Shows a gold wireframe over the model.
- **Clay Shading:** Enables the gold clay material.
- **Faceted Surface:** Shows polygon faces more clearly, closer to the original tiled clay look.
- **Invert Orbit Y:** Restores the old inverted vertical orbit behavior if needed.
- **Light Intensity:** Adjusts viewport brightness.
- **Light Left / Right:** Moves the main light direction around the object.

## Saving and Export

- **Save File:** Saves a `.sculptit` project file. Chromium-based browsers can show a real save-location picker. Other browsers may fall back to a normal download.
- **Load File:** Loads a `.sculptit` or compatible JSON project.
- **Quick Save / Quick Load:** Uses browser localStorage for fast temporary saves.
- **OBJ / STL:** Exports all visible layers as standard mesh files.

## Notes

SCULPTit is a local hobby/prototype tool. Very high detail levels or repeated subdivision can become slower depending on the browser and hardware. Save important work regularly as a project file.

### © complicatiion aka sksdesign · 2026