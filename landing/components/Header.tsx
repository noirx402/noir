'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from './Icons'
import { APK_URL, REPO, asset } from '@/lib/site'

const NAV = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#features', label: 'Features' },
  { href: '/#security', label: 'Security' },
  { href: '/#developers', label: 'Developers' },
  { href: '/docs/', label: 'Docs' },
]

export function Header() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [stars, setStars] = useState<number | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Star count is decoration: shown only when the GitHub API answers.
  useEffect(() => {
    fetch('https://api.github.com/repos/noirx402/noir')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.stargazers_count === 'number') setStars(d.stargazers_count) })
      .catch(() => {})
  }, [])

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`} id="top">
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="Noir home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('/assets/images/logo-mark.png')} alt="" className="brand-mark" width={28} height={29} />
          <span className="brand-word">NOIR</span>
        </Link>

        <nav className={`site-nav${open ? ' is-open' : ''}`} id="site-nav" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
              aria-current={n.href === '/docs/' && pathname.startsWith('/docs') ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <a className="gh-link" href={REPO} target="_blank" rel="noopener">
            <Icon name="gh" />
            <span className="gh-text">GitHub</span>
            {stars !== null && (
              <span className="gh-stars"><Icon name="star" size="xs" /><span>{stars.toLocaleString()}</span></span>
            )}
          </a>
          <a className="btn btn-gold btn-sm header-cta" href={APK_URL} download>Download</a>
          <button className={`nav-toggle${open ? ' is-open' : ''}`} type="button" aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(!open)}>
            <span /><span />
          </button>
        </div>
      </div>
    </header>
  )
}
