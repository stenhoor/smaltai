import { defineConfig } from 'vitepress'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { smaltLight, smaltDark } from './theme/shiki'
import { smaltworksMenu, smaltworksFooter } from './theme/smaltworks'
import { agentDocs, packageVersion } from './theme/agents'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = 'https://github.com/stenhoor/smaltai'
// GitHub Pages serves the site under the repository's name.
const BASE = process.env.SMALTAI_BASE ?? '/smaltai/'

export default defineConfig({
  title: 'smaltai',
  description: 'AI for the smalt apps, with a model you bring.',
  base: BASE,
  cleanUrls: true,
  lastUpdated: false,
  // Markdown for AI agents beside the pages: a twin of each page, /llms.txt and /agents.md (BRAND.md, Documentation).
  buildEnd: (config) => {
    agentDocs(config, {
      product: 'smaltai',
      version: packageVersion(path.resolve(here, '../../package.json')),
      url: `https://stenhoor.github.io${BASE}`,
      intro: 'guide/agents.md',
      guide: ['guide/'],
    })
  },
  head: [
    ['meta', { property: 'og:title', content: 'smaltai' }],
    ['meta', { property: 'og:description', content: 'AI for the smalt apps, with a model you bring.' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=Martian+Mono:wght@400;600&display=swap' }],
  ],
  markdown: {
    theme: { light: smaltLight, dark: smaltDark },
    config(md) {
      // Links that leave docs/ point at the file on GitHub.
      const fallback = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const href = tokens[idx].attrGet('href')
        if (href && !/^[a-z]+:|^#|^\//i.test(href) && env?.relativePath) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(env.relativePath), href))
          if (target.startsWith('../')) {
            tokens[idx].attrSet('href', `${REPO}/blob/HEAD/${target.slice(3)}`)
            tokens[idx].attrSet('target', '_blank')
            tokens[idx].attrSet('rel', 'noreferrer')
          }
        }
        return fallback(tokens, idx, options, env, self)
      }
    },
  },
  themeConfig: {
    // smaltai's marks are open (smalt-brand): the site shows its name until they are set.
    siteTitle: 'smaltai',
    // The four sections of every smalt site (BRAND.md, Documentation, rule 1).
    nav: [
      { text: 'Quick start', link: '/guide/quick-start' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/' },
      smaltworksMenu(),
    ],
    sidebar: [
      { text: 'Quick start', items: [{ text: 'Quick start', link: '/guide/quick-start' }] },
      {
        text: 'Getting started',
        items: [
          { text: 'What you need', link: '/guide/getting-started' },
          { text: 'For AI agents', link: '/guide/agents' },
        ],
      },
      {
        text: 'User guide',
        items: [
          { text: 'Gateways', link: '/guide/gateways' },
          { text: 'Grants', link: '/guide/grants' },
          { text: 'The log and the defences', link: '/guide/log-and-defences' },
        ],
      },
      { text: 'Reference', items: [{ text: 'Overview', link: '/reference/' }] },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    footer: smaltworksFooter(BASE),
    search: { provider: 'local' },
  },
})
