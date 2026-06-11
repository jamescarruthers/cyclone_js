# Third-party components in `vendor/`

## `three.module.min.js`

[three.js](https://threejs.org/) r160 (`three@0.160.0`, build
`three.module.min.js` from the npm package), © 2010-2023 Three.js
Authors, MIT license.

Vendored so the site has no runtime CDN dependency: the previous
`unpkg.com` importmap entry was a single point of failure — when the
CDN is unreachable (ad-blockers, restrictive networks, outages) the
entire ES-module graph fails to load and the game never starts.
