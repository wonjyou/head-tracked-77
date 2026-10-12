# Head-tracked 77

A 3D version of the seventyseven mark that shifts perspective as you move your head. The browser window behaves like a pane of glass in front of a box, and the webcam tells the page where your eyes are, so the logo holds its place behind the glass while the view around it changes.

## Run

```bash
node serve.js
```

Then open http://localhost:8773. There is no build step. Three.js and the MediaPipe face tracker load from CDNs, so the page needs a network connection, and the camera only works on localhost or https.

## Use

- If the browser has a camera and you allow it, the view follows your head. Move left, right, up or down, or lean in and out.
- Without a camera, the view follows the mouse. On a phone or tablet, tap or drag on the scene.
- The switch in the lower-right corner changes between mouse and head tracking. It is hidden when the device has no camera.
- While your face is being tracked, a crosshair button appears next to the switch. It makes your current head position the new straight-on view.
- If you turn on the camera and the browser has blocked it, a panel explains how to allow access.

Seen straight on, the two sevens nest the way they do in the flat mark. The inner seven sits far behind the outer one, so they pull apart as soon as you move off centre.

## How it works

The page finds your two irises with MediaPipe's face landmarker. Their midpoint in the camera image gives the direction to your head, and the distance between them gives how far away you are, assuming an average pupil spacing and a typical webcam field of view. A One Euro filter steadies the result.

That eye position drives an off-axis projection: the view frustum is the pyramid from your eye through the edges of the window, which is lopsided whenever you are off centre. Drawing the scene this way is what makes the box look fixed behind the screen.

The logo comes from `seventyseven.svg`, which holds the two polygons of the mark. Each is extruded and placed on its own plane. The rear one is scaled up by the amount its extra distance shrinks it, so both line up from the resting viewpoint. The response is also flattened near the centre, which makes the aligned view easy to find and hold.

## Tuning

These constants are near the top of `main.js`:

- `GAIN`: how strongly sideways head movement moves the view.
- `CENTRE_SLACK` and `DISTANCE_SLACK`: how forgiving the centred view is. Larger values are more forgiving.
- `SEVEN_Z`: how far apart in depth the two sevens sit.
- `SHADE`: the color of the extruded sides.

## Files

- `index.html`: page, controls and styles
- `main.js`: scene, projection, head tracking and controls
- `seventyseven.svg`: the logo outlines
- `serve.js`: static server for local use
