import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './smaltdb.css'
import { withSmaltworks } from './stage'

// The site kit (smalt-brand themes/vitepress/) is copied unchanged; this file is smaltai's own.
export default { extends: DefaultTheme, Layout: withSmaltworks(DefaultTheme) } satisfies Theme
