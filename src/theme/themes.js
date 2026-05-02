/**
 * themes.js — color palettes for dark and light themes.
 *
 * Token naming:
 *   bg / surface / surfaceAlt   — backgrounds
 *   border / borderMid / borderStrong / borderFocus  — borders, light→heavy
 *   text                        — primary content
 *   textEditor                  — note body text
 *   textSub                     — secondary content (filenames etc)
 *   textBody                    — readable body copy (settings descriptions)
 *   textMuted → textMicro       — progressively dimmer UI labels
 *   placeholder / placeholderGhost  — input hint text
 *   error / errorMuted          — destructive / warning
 *   highlight                   — TouchableHighlight underlay
 *   overlay                     — modal scrim
 */

export const dark = {
  bg:               '#0d0d0d',
  surface:          '#111111',
  surfaceAlt:       '#161616',
  border:           '#1a1a1a',
  borderMid:        '#1e1e1e',
  borderStrong:     '#2a2a2a',
  borderFocus:      '#333333',
  text:             '#ffffff',
  textEditor:       '#ffffff',
  textSub:          '#ffffff',
  textBody:         '#ffffff',
  textMuted:        '#ffffff',
  textDim:          '#ffffff',
  textDimmer:       '#ffffff',
  textFaint:        '#ffffff',
  textGhost:        '#ffffff',
  textTiny:         '#ffffff',
  textMicro:        '#ffffff',
  placeholder:      '#555555',
  placeholderGhost: '#444444',
  error:            '#c0392b',
  errorMuted:       '#7a3a3a',
  highlight:        '#1a1a1a',
  overlay:          'rgba(0,0,0,0.85)',
};

export const light = {
  bg:               '#f5f5f0',
  surface:          '#ffffff',
  surfaceAlt:       '#f0f0eb',
  border:           '#e0e0e0',
  borderMid:        '#d8d8d8',
  borderStrong:     '#cccccc',
  borderFocus:      '#aaaaaa',
  text:             '#000000',
  textEditor:       '#000000',
  textSub:          '#000000',
  textBody:         '#000000',
  textMuted:        '#000000',
  textDim:          '#000000',
  textDimmer:       '#000000',
  textFaint:        '#000000',
  textGhost:        '#000000',
  textTiny:         '#000000',
  textMicro:        '#000000',
  placeholder:      '#999999',
  placeholderGhost: '#bbbbbb',
  error:            '#c0392b',
  errorMuted:       '#b03030',
  highlight:        '#e0e0e0',
  overlay:          'rgba(0,0,0,0.65)',
};
