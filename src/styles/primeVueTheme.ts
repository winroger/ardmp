import { definePreset } from '@primevue/themes'
import Aura from '@primevue/themes/aura'
import { lightPalette } from './brandColors'

export const applicationTheme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#F0F0FE', 100: '#E2E4FD', 200: '#C6CBFB', 300: '#A4ACF8', 400: '#7C87F5',
      500: lightPalette.accent, 600: '#464FC4', 700: '#363BA2', 800: '#282A7F', 900: lightPalette.accentText, 950: '#11103F',
    },
    colorScheme: {
      light: {
        surface: { 0: lightPalette.canvas, 50: lightPalette.canvas, 100: lightPalette.surface, 200: lightPalette.border,
          300: '#B5BAB1', 400: '#8B9286', 500: lightPalette.secondaryText, 600: '#4F544D', 700: '#3B4039', 800: lightPalette.text, 900: '#1C1F1B', 950: '#11140F' },
        primary: { color: lightPalette.accent, contrastColor: '#FFFFFF', hoverColor: '#464FC4', activeColor: lightPalette.accentText },
        highlight: { background: '#E2E4FD', focusBackground: '#C6CBFB', color: lightPalette.accentText, focusColor: lightPalette.accentText },
        text: { color: lightPalette.text, hoverColor: lightPalette.text, mutedColor: lightPalette.secondaryText, hoverMutedColor: lightPalette.text },
        content: { background: lightPalette.surface, hoverBackground: '#E4E6DE', borderColor: lightPalette.border, color: lightPalette.text, hoverColor: lightPalette.text },
        formField: { background: lightPalette.canvas, borderColor: lightPalette.border, color: lightPalette.text, placeholderColor: lightPalette.secondaryText, iconColor: lightPalette.secondaryText },
        overlay: {
          select: { background: lightPalette.canvas, borderColor: lightPalette.border, color: lightPalette.text },
          popover: { background: lightPalette.canvas, borderColor: lightPalette.border, color: lightPalette.text },
          modal: { background: lightPalette.canvas, borderColor: lightPalette.border, color: lightPalette.text },
        },
      },
    },
  },
})
