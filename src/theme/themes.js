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
  text:             '#e8e8e8',
  textEditor:       '#d8d8d8',
  textSub:          '#c0c0c0',
  textBody:         '#999999',
  textMuted:        '#777777',
  textDim:          '#666666',
  textDimmer:       '#555555',
  textFaint:        '#444444',
  textGhost:        '#333333',
  textTiny:         '#2a2a2a',
  textMicro:        '#1a1a1a',
  placeholder:      '#444444',
  placeholderGhost: '#333333',
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
  text:             '#111111',
  textEditor:       '#1a1a1a',
  textSub:          '#333333',
  textBody:         '#555555',
  textMuted:        '#666666',
  textDim:          '#777777',
  textDimmer:       '#888888',
  textFaint:        '#999999',
  textGhost:        '#aaaaaa',
  textTiny:         '#bbbbbb',
  textMicro:        '#cccccc',
  placeholder:      '#aaaaaa',
  placeholderGhost: '#cccccc',
  error:            '#c0392b',
  errorMuted:       '#b03030',
  highlight:        '#e0e0e0',
  overlay:          'rgba(0,0,0,0.65)',
};
