import { chartColors, lightPalette } from '@/styles/brandColors'

export const CANVAS_EDGE_COLORS = {
  primary: lightPalette.accentText,
  structural: lightPalette.border,
} as const

export const CANVAS_EDGE_STYLES = {
  primary: {
    stroke: CANVAS_EDGE_COLORS.primary,
    strokeWidth: 2,
  },
  primaryDashed: {
    stroke: CANVAS_EDGE_COLORS.primary,
    strokeWidth: 2,
    strokeDasharray: '8 4',
  },
  structural: {
    stroke: CANVAS_EDGE_COLORS.structural,
    strokeWidth: 2,
    strokeDasharray: '6 3',
  },
} as const

export const CANVAS_NODE_COLORS = {
  importer: {
    headerBackground: '#E6EBE5',
    headerColor: chartColors[1],
    subtleColor: chartColors[1],
    previewBorderColor: 'rgba(0, 41, 32, 0.18)',
    handleColor: chartColors[1],
    borderColor: '#B5C5BB',
    accentBackground: '#E6EBE5',
    accentHoverBackground: '#D3DED5',
    badgeBackground: '#DEE7E1',
    badgeBorderColor: '#B5C5BB',
    badgeColor: chartColors[1],
    codeBackground: 'rgba(255, 255, 255, 0.72)',
  },
  enricher: {
    headerBackground: '#E2E4FD',
    headerColor: lightPalette.accentText,
    subtleColor: lightPalette.accentText,
    previewBorderColor: 'rgba(88, 101, 242, 0.18)',
    handleColor: chartColors[0],
    inputHandleColor: '#7C87F5',
    outputHandleColor: chartColors[0],
  },
  transform: {
    headerBackground: '#ECDFE5',
    headerColor: chartColors[2],
    subtleColor: chartColors[2],
    previewBorderColor: 'rgba(56, 31, 44, 0.18)',
    handleColor: chartColors[2],
    inputHandleColor: '#8B687B',
    outputHandleColor: chartColors[2],
  },
  shape: {
    headerBackground: '#F0F0FE',
    headerColor: lightPalette.accentText,
    subtleColor: chartColors[0],
    previewBorderColor: 'rgba(88, 101, 242, 0.18)',
    handleColor: chartColors[0],
    accentBackground: '#F0F0FE',
    accentHoverBackground: '#E2E4FD',
    badgeBackground: '#E2E4FD',
    badgeBorderColor: '#C6CBFB',
    badgeColor: lightPalette.accentText,
    inheritedBackground: lightPalette.canvas,
  },
} as const
